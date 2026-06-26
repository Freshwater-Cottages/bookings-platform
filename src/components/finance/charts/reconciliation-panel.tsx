"use client";

import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/utils";
import { FINANCE_SERIES_COLORS } from "./finance-chart-theme";
import { TrendChart } from "./trend-chart";

export type ReconciliationStatus = "TIES" | "DOES_NOT_TIE" | "XERO_UNAVAILABLE";

export interface ReconciliationPanelPeriod {
  periodLabel: string;
  xeroHutFeesIncomeCents: number | null;
  bookingHutFeesCents: number;
  varianceCents: number | null;
  status: ReconciliationStatus;
}

export interface ReconciliationPanelProps {
  periods: ReconciliationPanelPeriod[];
  overallStatus: ReconciliationStatus;
  emptyMessage?: string;
}

const STATUS_META: Record<
  ReconciliationStatus,
  { label: string; variant: "success" | "warning" | "secondary" }
> = {
  TIES: { label: "Ties", variant: "success" },
  DOES_NOT_TIE: { label: "Variance", variant: "warning" },
  XERO_UNAVAILABLE: { label: "Xero unavailable", variant: "secondary" },
};

export function ReconciliationPanel({
  periods,
  overallStatus,
  emptyMessage = "No revenue snapshots are available to reconcile yet.",
}: ReconciliationPanelProps) {
  if (periods.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">{emptyMessage}</p>
    );
  }

  // Periods arrive newest-first; show the chart oldest-to-newest.
  const chartData = [...periods].reverse().map((period) => ({
    label: period.periodLabel,
    xero: period.xeroHutFeesIncomeCents ?? 0,
    booking: period.bookingHutFeesCents,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Xero hut-fee income vs booking-system hut fees, by month.
        </p>
        <Badge variant={STATUS_META[overallStatus].variant}>
          {STATUS_META[overallStatus].label}
        </Badge>
      </div>

      <TrendChart
        variant="bar"
        xKey="label"
        data={chartData}
        series={[
          {
            key: "xero",
            name: "Xero income",
            color: FINANCE_SERIES_COLORS.revenue,
            valueType: "currency",
          },
          {
            key: "booking",
            name: "Booking system",
            color: FINANCE_SERIES_COLORS.bookings,
            valueType: "currency",
          },
        ]}
      />

      <div className="space-y-2">
        {periods.map((period) => (
          <div
            key={period.periodLabel}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <span className="font-medium text-slate-900">
              {period.periodLabel}
            </span>
            <span className="text-slate-600">
              Xero{" "}
              {period.xeroHutFeesIncomeCents === null
                ? "—"
                : formatCents(period.xeroHutFeesIncomeCents)}{" "}
              · Booking {formatCents(period.bookingHutFeesCents)}
              {period.varianceCents !== null ? (
                <>
                  {" "}
                  · Variance {formatCents(period.varianceCents)}
                </>
              ) : null}
            </span>
            <Badge variant={STATUS_META[period.status].variant}>
              {STATUS_META[period.status].label}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
