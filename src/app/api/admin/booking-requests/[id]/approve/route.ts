import { NextRequest, NextResponse } from "next/server";
import { BookingRequestType } from "@prisma/client";
import { approveBookingRequest, BookingRequestError } from "@/lib/booking-request";
import { approveSchoolBookingRequest } from "@/lib/school-booking-request";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session-guards";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const { id } = await params;

  const requestRow = await prisma.bookingRequest.findUnique({
    where: { id },
    select: { type: true },
  });
  if (!requestRow) {
    return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
  }

  try {
    if (requestRow.type === BookingRequestType.SCHOOL) {
      const result = await approveSchoolBookingRequest({
        requestId: id,
        adminMemberId: session.user.id,
      });

      if (result.type === "capacityExceeded") {
        return NextResponse.json(
          {
            error: "The lodge is at capacity for one or more of the requested nights",
            fullNights: result.fullNights,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        type: "SCHOOL",
        bookingId: result.bookingId,
        memberId: result.schoolMemberId,
        priceCents: result.priceCents,
        invoiceMode: result.invoiceMode,
        teacherCount: result.teacherCount,
      });
    }

    const result = await approveBookingRequest({
      requestId: id,
      adminMemberId: session.user.id,
    });

    if (result.type === "capacityExceeded") {
      return NextResponse.json(
        {
          error: "The lodge is at capacity for one or more of the requested nights",
          fullNights: result.fullNights,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      type: "GENERAL",
      bookingId: result.bookingId,
      memberId: result.memberId,
      priceCents: result.priceCents,
      paymentLinkExpiresAt: result.paymentLinkExpiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof BookingRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
