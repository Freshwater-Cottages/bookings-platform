import { BookingRequestQuoteStatus, BookingStatus } from "@prisma/client";
import { issueActionToken } from "@/lib/action-tokens";
import { logAudit } from "@/lib/audit";
import { reconcileBedAllocationsForBooking } from "@/lib/bed-allocation-lifecycle";
import {
  getBookingRequestSettings,
  parseBookingRequestGuests,
} from "@/lib/booking-request";
import { parseBookingRequestQuoteOptions } from "@/lib/booking-request-quotes";
import { sendBookingRequestQuoteEmail } from "@/lib/email";
import logger from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Send a single pre-expiry reminder for public booking-request quotes that are
 * still awaiting a response. The reminder rotates the quote's response token and
 * emails a fresh working link, so the requester never has to find the original
 * quote email. Each quote is reminded at most once (tracked by `reminderSentAt`).
 *
 * Reminders are disabled when the admin sets `quoteReminderLeadDays` to 0.
 */
export async function sendQuoteExpiryReminders(): Promise<{
  remindedCount: number;
  failedCount: number;
  releasedHoldCount: number;
}> {
  const now = new Date();
  const settings = await getBookingRequestSettings();
  const leadDays = settings.quoteReminderLeadDays;

  let remindedCount = 0;
  let failedCount = 0;

  // Phase 1: pre-expiry reminders. Disabled when leadDays <= 0, but the hold
  // release in phase 2 still runs — an ignored quote's held bed must be freed
  // regardless of the reminder setting (issue #1254).
  const reminderQuotes =
    leadDays > 0
      ? await prisma.bookingRequestQuote.findMany({
          where: {
            status: BookingRequestQuoteStatus.SENT,
            reminderSentAt: null,
            responseTokenExpiresAt: {
              gt: now,
              lte: new Date(now.getTime() + leadDays * DAY_MS),
            },
          },
          include: { bookingRequest: true },
        })
      : [];

  for (const quote of reminderQuotes) {
    const request = quote.bookingRequest;
    const expiresAt = quote.responseTokenExpiresAt;
    if (!expiresAt) continue;

    // Rotate the response token first so the reminder email carries a working
    // link. `reminderSentAt` is only set after a successful send, so a delivery
    // failure is retried on the next run rather than silently swallowed.
    const { token, tokenHash } = issueActionToken();
    await prisma.bookingRequestQuote.update({
      where: { id: quote.id },
      data: { responseTokenHash: tokenHash },
    });

    try {
      const options = parseBookingRequestQuoteOptions(quote.options);
      await sendBookingRequestQuoteEmail({
        email: request.contactEmail,
        firstName: request.contactFirstName,
        token,
        checkIn: request.checkIn,
        checkOut: request.checkOut,
        guestCount: parseBookingRequestGuests(request.guests).length,
        requestType: request.type,
        schoolName: request.schoolName,
        options: options.map((option) => ({
          label: option.label,
          totalCents: option.totalCents,
        })),
        message: quote.message,
        expiresAt,
        isReminder: true,
      });

      await prisma.bookingRequestQuote.update({
        where: { id: quote.id },
        data: { reminderSentAt: now },
      });

      remindedCount += 1;
      logAudit({
        action: "booking_request.quote_reminder_sent",
        targetId: request.id,
        entityType: "BookingRequest",
        entityId: request.id,
        category: "booking",
        outcome: "success",
        summary: "Sent a pre-expiry reminder for an outstanding quote",
        metadata: {
          quoteId: quote.id,
          version: quote.version,
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (err) {
      failedCount += 1;
      logger.error(
        { err, quoteId: quote.id, bookingRequestId: quote.bookingRequestId },
        "Failed to send booking request quote reminder",
      );
    }
  }

  // Phase 2: release beds held for SENT quotes past their response window
  // (issue #1254). Auto-hold-on-send means an unanswered quote would otherwise
  // sterilise a bed until check-in; free it once the link lapses. The request
  // stays QUOTE_SENT so an admin can re-quote (which re-holds); nothing here
  // charges, emails, or cancels the request.
  const releasedHoldCount = await releaseExpiredQuoteHolds(now);

  return { remindedCount, failedCount, releasedHoldCount };
}

/**
 * Free the AWAITING_REVIEW hold behind any SENT quote whose response token has
 * expired (issue #1254). Idempotent and concurrency-safe: each release runs
 * under the shared booking advisory lock and re-verifies, so a race with a
 * late accept (quote flips to ACCEPTED; held row flips to PENDING) or a
 * requester cancel is a no-op rather than cancelling a live booking.
 */
async function releaseExpiredQuoteHolds(now: Date): Promise<number> {
  const expiredHeldQuotes = await prisma.bookingRequestQuote.findMany({
    where: {
      status: BookingRequestQuoteStatus.SENT,
      responseTokenExpiresAt: { lte: now },
      bookingRequest: { heldBookingId: { not: null } },
    },
    select: {
      id: true,
      version: true,
      bookingRequestId: true,
      bookingRequest: { select: { heldBookingId: true } },
    },
  });

  let releasedHoldCount = 0;

  for (const quote of expiredHeldQuotes) {
    const heldBookingId = quote.bookingRequest.heldBookingId;
    if (!heldBookingId) continue;

    try {
      const released = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;

        // Re-read under the lock: only act while the request still points at
        // this exact hold and the hold is still an unaccepted AWAITING_REVIEW
        // row. An accept converts it to PENDING (and the quote to ACCEPTED), so
        // we must never cancel that live booking.
        const request = await tx.bookingRequest.findUnique({
          where: { id: quote.bookingRequestId },
          select: { heldBookingId: true },
        });
        if (request?.heldBookingId !== heldBookingId) return false;

        const held = await tx.booking.findUnique({
          where: { id: heldBookingId },
          select: { status: true },
        });
        if (!held || held.status !== BookingStatus.AWAITING_REVIEW) {
          return false;
        }

        await tx.booking.update({
          where: { id: heldBookingId },
          data: { status: BookingStatus.CANCELLED, nonMemberHoldUntil: null },
        });
        await reconcileBedAllocationsForBooking({
          bookingId: heldBookingId,
          db: tx,
        });
        await tx.bookingRequest.update({
          where: { id: quote.bookingRequestId },
          data: { heldBookingId: null },
        });
        return true;
      });

      if (released) {
        releasedHoldCount += 1;
        logAudit({
          action: "booking_request.quote_hold_released_on_expiry",
          targetId: quote.bookingRequestId,
          entityType: "BookingRequest",
          entityId: quote.bookingRequestId,
          category: "booking",
          outcome: "success",
          summary:
            "Released the bed held for an unanswered quote after its link expired",
          metadata: {
            quoteId: quote.id,
            version: quote.version,
            releasedBookingId: heldBookingId,
          },
        });
      }
    } catch (err) {
      logger.error(
        { err, quoteId: quote.id, bookingRequestId: quote.bookingRequestId },
        "Failed to release expired quote hold",
      );
    }
  }

  return releasedHoldCount;
}
