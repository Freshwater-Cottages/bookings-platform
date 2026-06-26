import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface KpiStatCardProps {
  title: string;
  value: string;
  description?: string;
  footnote?: string;
}

/**
 * A single headline metric card. Presentational only (no charts), so it renders
 * on the server alongside the finance pages.
 */
export function KpiStatCard({
  title,
  value,
  description,
  footnote,
}: KpiStatCardProps) {
  return (
    <Card className="reports-print-card">
      <CardHeader className="pb-3">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl text-slate-900">{value}</CardTitle>
      </CardHeader>
      {description || footnote ? (
        <CardContent className="space-y-2">
          {description ? (
            <p className="text-sm leading-6 text-slate-600">{description}</p>
          ) : null}
          {footnote ? (
            <p className="text-xs font-medium text-slate-500">{footnote}</p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
