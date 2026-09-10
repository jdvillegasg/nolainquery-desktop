import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, Clock, Coins } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { QueryThread } from "./queryThreads";
import {
  buildUsageTimeSeries,
  collectUsageRecords,
  formatLlmTime,
  formatTokenCount,
  getUsageSnapshot,
  PERIOD_LABELS,
  toCumulativeTokenSeries,
  type UsagePeriod,
} from "./usageMetrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SettingsUsagePanelProps {
  revision: number;
  queryThreads?: QueryThread[];
}

const CHART_COLORS = {
  primary: "#525252",
  secondary: "#78716c",
} as const;

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  borderColor: "#ebebeb",
  borderRadius: 8,
  color: "#1c1917",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  padding: "6px 10px",
} as const;

const CHART_AXIS_PROPS = {
  stroke: "#d4d4d4",
  tick: { fontSize: 10, fontFamily: "Inter, system-ui, sans-serif", fill: "#78716c" },
} as const;

const CHART_GRID_PROPS = { strokeDasharray: "3 3", stroke: "#ebebeb" } as const;

function PeriodToggles({
  period,
  onChange,
  id,
}: {
  period: UsagePeriod;
  onChange: (p: UsagePeriod) => void;
  id: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] p-0.5"
      role="tablist"
      aria-label={id}
    >
      {(Object.keys(PERIOD_LABELS) as UsagePeriod[]).map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={period === key}
          className={cn(
            "cursor-pointer rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-[11px] font-semibold transition-all duration-200",
            period === key
              ? "bg-stone-100 text-[var(--color-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:bg-stone-50 hover:text-[var(--color-foreground)]",
          )}
          onClick={() => onChange(key)}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3.5 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <span className="font-[family-name:var(--font-mono)] text-lg font-semibold tabular-nums text-[var(--color-foreground)]">
        {value}
      </span>
      {hint ? <span className="text-[11px] text-[var(--color-muted-foreground)]">{hint}</span> : null}
    </div>
  );
}

function UsageChartBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold tracking-tight text-[var(--color-foreground)]">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">{subtitle}</p>
      </div>
      <div className="min-h-[240px] w-full">{children}</div>
    </div>
  );
}

export default function SettingsUsagePanel({
  revision,
  queryThreads,
}: SettingsUsagePanelProps) {
  const [period, setPeriod] = useState<UsagePeriod>("7d");

  const records = useMemo(() => {
    void revision;
    return collectUsageRecords(queryThreads);
  }, [revision, queryThreads]);

  const snapshot = useMemo(() => getUsageSnapshot(queryThreads), [records, queryThreads]);

  const buckets = useMemo(
    () => buildUsageTimeSeries(records, period),
    [records, period],
  );

  const cumulativeTokens = useMemo(() => toCumulativeTokenSeries(buckets), [buckets]);
  const hasTokenSeries = cumulativeTokens.some((b) => b.total > 0);
  const hasTimeSeries = buckets.some((b) => b.avgAnswerTimeSec != null && b.avgAnswerTimeSec > 0);

  const timeChartData = useMemo(
    () =>
      buckets.map((b) => ({
        label: b.label,
        seconds: b.avgAnswerTimeSec ?? 0,
        queries: b.queryCount,
      })),
    [buckets],
  );

  const last = snapshot.lastQuery;
  const periodTotals = snapshot.byPeriod[period];
  const hasAnyHistory =
    records.length > 0 || Object.values(snapshot.byPeriod).some((p) => p.queryCount > 0);

  const periodHint =
    period === "1d" ? "Last 24 hours, by hour" : period === "7d" ? "Last 7 days" : "Last 30 days";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {!hasAnyHistory ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Usage
              </span>
            </div>
            <CardTitle className="text-lg">Query usage</CardTitle>
            <CardDescription>
              Token consumption and answer times from your Ask Queries history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              No query history yet. Ask a question in Ask Queries to start collecting usage stats.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Coins className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Token consumption
                    </span>
                  </div>
                  <CardTitle className="text-lg">Tokens</CardTitle>
                  <CardDescription className="mb-0">
                    Input and output tokens per generation job. {periodHint}.
                  </CardDescription>
                </div>
                <PeriodToggles period={period} onChange={setPeriod} id="Token period" />
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-2 min-[720px]:grid-cols-4">
                <MetricCard
                  label="Last query · input"
                  value={formatTokenCount(last?.inputTokens)}
                  hint={last && !last.hasTokenData ? "Not stored for this turn" : undefined}
                />
                <MetricCard
                  label="Last query · output"
                  value={formatTokenCount(last?.outputTokens)}
                  hint={last && !last.hasTokenData ? "Not stored for this turn" : undefined}
                />
                <MetricCard
                  label={`Total · ${PERIOD_LABELS[period].toLowerCase()}`}
                  value={formatTokenCount(periodTotals.totalTokens)}
                  hint={
                    periodTotals.queryCount === 0
                      ? "No queries"
                      : `${periodTotals.queryCount} quer${periodTotals.queryCount === 1 ? "y" : "ies"}`
                  }
                />
                <MetricCard
                  label="Input / output"
                  value={
                    periodTotals.totalTokens != null && periodTotals.totalTokens > 0
                      ? `${Math.round(((periodTotals.inputTokens ?? 0) / periodTotals.totalTokens) * 100)}% in`
                      : "—"
                  }
                  hint={
                    periodTotals.totalTokens != null
                      ? `${formatTokenCount(periodTotals.inputTokens)} / ${formatTokenCount(periodTotals.outputTokens)}`
                      : undefined
                  }
                />
              </div>

              <UsageChartBlock
                title="Cumulative tokens"
                subtitle={`Stacked input vs output across ${periodHint.toLowerCase()}.`}
              >
                {hasTokenSeries ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={cumulativeTokens} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
                      <XAxis dataKey="label" {...CHART_AXIS_PROPS} tickLine={false} interval="preserveStartEnd" />
                      <YAxis
                        {...CHART_AXIS_PROPS}
                        tickLine={false}
                        width={48}
                        tickFormatter={(v) => formatTokenCount(Number(v))}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value, name) => [
                          formatTokenCount(typeof value === "number" ? value : Number(value)),
                          name === "input" ? "Input (cum.)" : "Output (cum.)",
                        ]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, fontFamily: "Inter, system-ui, sans-serif" }}
                        formatter={(value) => (value === "input" ? "Input" : "Output")}
                      />
                      <Area
                        type="monotone"
                        dataKey="input"
                        stackId="tokens"
                        stroke={CHART_COLORS.primary}
                        fill={CHART_COLORS.primary}
                        fillOpacity={0.2}
                        strokeWidth={1.5}
                      />
                      <Area
                        type="monotone"
                        dataKey="output"
                        stackId="tokens"
                        stroke={CHART_COLORS.secondary}
                        fill={CHART_COLORS.secondary}
                        fillOpacity={0.35}
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                    No token counts in this period yet. New generations will populate this chart.
                  </p>
                )}
              </UsageChartBlock>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Query time
                    </span>
                  </div>
                  <CardTitle className="text-lg">Answer time</CardTitle>
                  <CardDescription className="mb-0">
                    LLM time when reported; otherwise wall clock from question to answer. {periodHint}.
                  </CardDescription>
                </div>
                <PeriodToggles period={period} onChange={setPeriod} id="Time period" />
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-2 min-[720px]:grid-cols-4">
                <MetricCard
                  label="Last query"
                  value={formatLlmTime(last?.answerTimeSec)}
                  hint={last?.usedLlmTime ? "LLM time" : "Wall clock"}
                />
                <MetricCard
                  label="Avg last 5"
                  value={formatLlmTime(snapshot.last5AvgAnswerTimeSec)}
                  hint="Recent queries"
                />
                <MetricCard
                  label={`Avg · ${PERIOD_LABELS[period].toLowerCase()}`}
                  value={formatLlmTime(periodTotals.avgAnswerTimeSec)}
                  hint={
                    periodTotals.queryCount === 0
                      ? "No queries"
                      : `${periodTotals.queryCount} quer${periodTotals.queryCount === 1 ? "y" : "ies"}`
                  }
                />
                <MetricCard
                  label="Queries"
                  value={String(periodTotals.queryCount)}
                  hint={`In selected ${PERIOD_LABELS[period].toLowerCase()}`}
                />
              </div>

              <UsageChartBlock
                title="Average answer time"
                subtitle={`Mean time per ${period === "1d" ? "hour" : "day"} in the selected window.`}
              >
                {hasTimeSeries ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={timeChartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
                      <XAxis dataKey="label" {...CHART_AXIS_PROPS} tickLine={false} interval="preserveStartEnd" />
                      <YAxis
                        {...CHART_AXIS_PROPS}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v) => formatLlmTime(Number(v))}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value) => [
                          formatLlmTime(typeof value === "number" ? value : Number(value)),
                          "Avg time",
                        ]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area
                        type="monotone"
                        dataKey="seconds"
                        stroke={CHART_COLORS.primary}
                        fill={CHART_COLORS.primary}
                        fillOpacity={0.12}
                        strokeWidth={2}
                        name="Avg time"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                    No timed queries in this period.
                  </p>
                )}
              </UsageChartBlock>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
