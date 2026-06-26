"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type FinanceValueType,
  formatFinanceValue,
} from "./finance-chart-theme";

export interface KpiTrendPoint {
  label: string;
  value: number;
}

export interface KpiTrendCardProps {
  title: string;
  value: string;
  color: string;
  valueType: FinanceValueType;
  series: KpiTrendPoint[];
  description?: string;
}

interface TooltipPayloadEntry {
  value?: number | string | ReadonlyArray<number | string>;
  payload?: KpiTrendPoint;
}

/** A headline metric with a compact sparkline of its recent trend. */
export function KpiTrendCard({
  title,
  value,
  color,
  valueType,
  series,
  description,
}: KpiTrendCardProps) {
  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: readonly TooltipPayloadEntry[];
  }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const entry = payload[0];
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
        <span className="font-medium text-slate-900">
          {entry.payload?.label}:{" "}
        </span>
        <span className="text-slate-600">
          {formatFinanceValue(Number(entry.value ?? 0), valueType)}
        </span>
      </div>
    );
  };

  return (
    <Card className="reports-print-card">
      <CardHeader className="pb-3">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl text-slate-900">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {description ? (
          <p className="text-sm leading-6 text-slate-600">{description}</p>
        ) : null}
        {series.length > 1 ? (
          <div className="h-16 print:hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <Tooltip content={renderTooltip} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
