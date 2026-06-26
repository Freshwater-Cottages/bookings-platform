/**
 * Revenue reconciliation between Xero and the booking system.
 *
 * For each recent month we compare the hut-fee income recognised in Xero (from
 * the stored profit-and-loss snapshot) against the hut-fee revenue the booking
 * system recorded over the same period (summed from per-guest-night prices).
 * The two are expected to be close; a material gap is surfaced so finance can
 * investigate. Membership income is reported from Xero only, because the app
 * does not store a membership fee amount locally (only the paid count).
 *
 * Reconciling items to expect: stay-night recognition vs Xero invoice/accrual
 * timing, refunds/discounts (booking nights are gross), and any non-NZD lines.
 */

import { FinanceSnapshotType, SubscriptionStatus } from "@prisma/client";
import { APP_LOCALE, APP_TIME_ZONE } from "@/config/operational";
import { prisma } from "@/lib/prisma";
import { FINANCE_REALIZED_BOOKING_STATUSES } from "@/lib/finance-booking-metrics";
import {
  DEFAULT_FINANCE_SNAPSHOT_SCOPE,
  listFinanceSnapshots,
} from "@/lib/finance-sync-storage";
import {
  extractPnlLineItems,
  extractPnlSectionTotalCents,
  findPnlSection,
  readPnlPeriodLabel,
  readPnlReportPayload,
  type PnlLineItem,
} from "@/lib/finance-pnl-snapshot";

const INCOME_SECTION_KEYWORDS = ["income", "revenue"];
const INCOME_SUMMARY_KEYWORDS = ["total income", "total revenue"];
const HUT_FEE_LABEL_KEYWORDS = ["hut fee", "hut fees", "accommodation"];
const SUBSCRIPTION_LABEL_KEYWORDS = ["subscription", "membership"];

const DEFAULT_RECONCILIATION_PERIODS = 6;
const MAX_RECONCILIATION_PERIODS = 24;
const DEFAULT_TOLERANCE_PCT = 0.01; // 1%
const DEFAULT_TOLERANCE_CENTS = 5000; // $50
const MILLISECONDS_PER_DAY = 86_400_000;

export type FinanceReconciliationStatus =
  | "TIES"
  | "DOES_NOT_TIE"
  | "XERO_UNAVAILABLE";

export interface FinanceReconciliationPeriod {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  xeroHutFeesIncomeCents: number | null;
  xeroSubscriptionIncomeCents: number | null;
  xeroTotalIncomeCents: number | null;
  bookingHutFeesCents: number;
  bookingMemberHutFeesCents: number;
  bookingNonMemberHutFeesCents: number;
  paidSubscriptionCount: number;
  varianceCents: number | null;
  variancePct: number | null;
  status: FinanceReconciliationStatus;
}

export interface FinanceRevenueReconciliation {
  generatedAt: string;
  overallStatus: FinanceReconciliationStatus;
  toleranceCents: number;
  tolerancePct: number;
  periods: FinanceReconciliationPeriod[];
}

type FinanceSnapshotRecord = Awaited<
  ReturnType<typeof listFinanceSnapshots>
>[number];

function clampPeriods(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RECONCILIATION_PERIODS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_RECONCILIATION_PERIODS);
}

function startOfMonthUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

function resolvePeriodBounds(snapshot: FinanceSnapshotRecord): {
  start: Date;
  end: Date;
} {
  const end = snapshot.periodEnd ?? snapshot.asOfDate;
  const start = snapshot.periodStart ?? startOfMonthUtc(end);
  return { start, end };
}

/** Key a snapshot by its calendar month so we keep one row per month. */
function periodKey(snapshot: FinanceSnapshotRecord): string {
  const { start } = resolvePeriodBounds(snapshot);
  return start.toISOString().slice(0, 7);
}

function sumMatchingLineItems(
  lineItems: PnlLineItem[],
  keywords: string[]
): number | null {
  const matched = lineItems.filter((item) =>
    keywords.some((keyword) => item.label.toLowerCase().includes(keyword))
  );
  if (matched.length === 0) {
    return null;
  }
  return matched.reduce((total, item) => total + item.amountCents, 0);
}

function parseXeroIncome(snapshot: FinanceSnapshotRecord): {
  hutFeesCents: number | null;
  subscriptionCents: number | null;
  totalCents: number | null;
} {
  const payload = readPnlReportPayload(snapshot.payload);
  if (!payload) {
    return { hutFeesCents: null, subscriptionCents: null, totalCents: null };
  }

  const incomeSection = findPnlSection(payload.rows, INCOME_SECTION_KEYWORDS);
  if (!incomeSection) {
    return { hutFeesCents: null, subscriptionCents: null, totalCents: null };
  }

  const lineItems = extractPnlLineItems(incomeSection);
  return {
    hutFeesCents: sumMatchingLineItems(lineItems, HUT_FEE_LABEL_KEYWORDS),
    subscriptionCents: sumMatchingLineItems(lineItems, SUBSCRIPTION_LABEL_KEYWORDS),
    totalCents: extractPnlSectionTotalCents(incomeSection, INCOME_SUMMARY_KEYWORDS),
  };
}

async function loadBookingHutFees(
  start: Date,
  end: Date
): Promise<{ total: number; member: number }> {
  const realizedStatuses = [...FINANCE_REALIZED_BOOKING_STATUSES];
  const dateWindow = { gte: start, lte: end };

  const [total, member] = await Promise.all([
    prisma.bookingGuestNight.aggregate({
      _sum: { priceCents: true },
      where: {
        stayDate: dateWindow,
        bookingGuest: { booking: { status: { in: realizedStatuses } } },
      },
    }),
    prisma.bookingGuestNight.aggregate({
      _sum: { priceCents: true },
      where: {
        stayDate: dateWindow,
        bookingGuest: {
          isMember: true,
          booking: { status: { in: realizedStatuses } },
        },
      },
    }),
  ]);

  return {
    total: total._sum.priceCents ?? 0,
    member: member._sum.priceCents ?? 0,
  };
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(APP_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

function resolveStatus(
  xeroHutFeesCents: number | null,
  varianceCents: number | null,
  toleranceCents: number,
  tolerancePct: number
): FinanceReconciliationStatus {
  if (xeroHutFeesCents === null || varianceCents === null) {
    return "XERO_UNAVAILABLE";
  }

  const allowed = Math.max(
    toleranceCents,
    Math.round(Math.abs(xeroHutFeesCents) * tolerancePct)
  );
  return Math.abs(varianceCents) <= allowed ? "TIES" : "DOES_NOT_TIE";
}

async function buildPeriod(
  snapshot: FinanceSnapshotRecord,
  toleranceCents: number,
  tolerancePct: number
): Promise<FinanceReconciliationPeriod> {
  const { start, end } = resolvePeriodBounds(snapshot);
  const payload = readPnlReportPayload(snapshot.payload);
  const periodLabel =
    (payload ? readPnlPeriodLabel(payload) : null) ?? formatMonthYear(end);

  const xero = parseXeroIncome(snapshot);
  const bookingHutFees = await loadBookingHutFees(start, end);
  const paidSubscriptionCount = await prisma.memberSubscription.count({
    where: {
      status: SubscriptionStatus.PAID,
      paidAt: { gte: start, lt: addUtcDays(end, 1) },
    },
  });

  const varianceCents =
    xero.hutFeesCents === null
      ? null
      : xero.hutFeesCents - bookingHutFees.total;
  const variancePct =
    xero.hutFeesCents === null || xero.hutFeesCents === 0
      ? null
      : Number(((varianceCents ?? 0) / xero.hutFeesCents).toFixed(4));

  return {
    periodLabel,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    xeroHutFeesIncomeCents: xero.hutFeesCents,
    xeroSubscriptionIncomeCents: xero.subscriptionCents,
    xeroTotalIncomeCents: xero.totalCents,
    bookingHutFeesCents: bookingHutFees.total,
    bookingMemberHutFeesCents: bookingHutFees.member,
    bookingNonMemberHutFeesCents: bookingHutFees.total - bookingHutFees.member,
    paidSubscriptionCount,
    varianceCents,
    variancePct,
    status: resolveStatus(
      xero.hutFeesCents,
      varianceCents,
      toleranceCents,
      tolerancePct
    ),
  };
}

function resolveOverallStatus(
  periods: FinanceReconciliationPeriod[]
): FinanceReconciliationStatus {
  if (periods.length === 0) {
    return "XERO_UNAVAILABLE";
  }
  if (periods.some((period) => period.status === "DOES_NOT_TIE")) {
    return "DOES_NOT_TIE";
  }
  if (periods.every((period) => period.status === "XERO_UNAVAILABLE")) {
    return "XERO_UNAVAILABLE";
  }
  return "TIES";
}

export async function buildFinanceRevenueReconciliation(input?: {
  periods?: number;
  toleranceCents?: number;
  tolerancePct?: number;
  now?: Date;
}): Promise<FinanceRevenueReconciliation> {
  const periodsRequested = clampPeriods(input?.periods);
  const toleranceCents = input?.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const tolerancePct = input?.tolerancePct ?? DEFAULT_TOLERANCE_PCT;

  const snapshots = await listFinanceSnapshots({
    snapshotType: FinanceSnapshotType.PROFIT_AND_LOSS_MONTHLY,
    scope: DEFAULT_FINANCE_SNAPSHOT_SCOPE,
    limit: 100,
  });

  // Snapshots are newest-first; keep the latest one per calendar month so a
  // daily sync of the current month does not crowd out earlier months.
  const latestByMonth = new Map<string, FinanceSnapshotRecord>();
  for (const snapshot of snapshots) {
    const key = periodKey(snapshot);
    if (!latestByMonth.has(key)) {
      latestByMonth.set(key, snapshot);
    }
  }

  const selected = Array.from(latestByMonth.values()).slice(0, periodsRequested);
  const periods = await Promise.all(
    selected.map((snapshot) => buildPeriod(snapshot, toleranceCents, tolerancePct))
  );

  return {
    generatedAt: (input?.now ?? new Date()).toISOString(),
    overallStatus: resolveOverallStatus(periods),
    toleranceCents,
    tolerancePct,
    periods,
  };
}
