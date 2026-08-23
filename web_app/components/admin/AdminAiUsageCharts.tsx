"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminCard, adminSelect } from "@/components/admin/admin-ui";
import type { AiUsageAnalytics } from "@/lib/adminApi";

const CHART_COLORS = ["#10b981", "#34d399", "#f59e0b", "#ef4444", "#14b8a6", "#06b6d4", "#a3e635", "#84cc16"];

const Y_MAX_OPTIONS = [
  { value: "auto", label: "Y: Auto" },
  { value: "10", label: "Y max 10" },
  { value: "50", label: "Y max 50" },
  { value: "100", label: "Y max 100" },
  { value: "250", label: "Y max 250" },
  { value: "500", label: "Y max 500" },
  { value: "1000", label: "Y max 1k" },
  { value: "5000", label: "Y max 5k" },
  { value: "10000", label: "Y max 10k" },
] as const;

const X_WINDOW_OPTIONS = [
  { value: "all", label: "X: All points" },
  { value: "3", label: "X: Last 3" },
  { value: "7", label: "X: Last 7" },
  { value: "14", label: "X: Last 14" },
  { value: "30", label: "X: Last 30" },
] as const;

const tooltipStyle = {
  contentStyle: {
    background: "#0c0c0c",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: "rgba(255,255,255,0.7)" },
  itemStyle: { color: "#fff" },
};

function AdminPiePanel({
  title,
  data,
  emptyLabel,
}: {
  title: string;
  data: { name: string; value: number }[];
  emptyLabel: string;
}) {
  const hasData = data.some((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  return (
    <div className={`${adminCard} flex h-full flex-col p-4 md:p-5`}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-white/45">{title}</p>
      {hasData ? (
        <>
          <div className="h-52 w-full shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="transparent"
                >
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {data.map((d, index) => {
              const pct = total > 0 ? Math.round((Number(d.value) / total) * 100) : 0;
              return (
                <li
                  key={d.name}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
                  title={d.name}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/65">{d.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-white/40">
                    {Number(d.value).toLocaleString()}
                    <span className="text-white/25"> · {pct}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="flex h-52 flex-1 items-center justify-center text-sm text-white/35">{emptyLabel}</p>
      )}
    </div>
  );
}

export function AdminAiUsageCharts({ analytics }: { analytics: AiUsageAnalytics }) {
  const [metric, setMetric] = useState<"requests" | "tokens">("requests");
  const [chartType, setChartType] = useState<"line" | "area">("area");
  const [xWindow, setXWindow] = useState<string>("all");
  const [yMax, setYMax] = useState<string>("auto");

  const modelKeys = useMemo(
    () =>
      analytics.models.map((model, index) => ({
        model,
        key: model.replace(/[^a-zA-Z0-9]/g, "_"),
        color: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [analytics.models]
  );

  const fullSeries = useMemo(() => {
    return analytics.timeSeries.map((point) => {
      const row: Record<string, string | number> = {
        label: point.label,
        bucket: point.bucket,
        total: 0,
      };
      let total = 0;
      for (const model of analytics.models) {
        const key = model.replace(/[^a-zA-Z0-9]/g, "_");
        const value = point.byModel[model]?.[metric] ?? 0;
        row[key] = value;
        total += Number(value) || 0;
      }
      row.total = total;
      return row;
    });
  }, [analytics, metric]);

  const seriesData = useMemo(() => {
    if (xWindow === "all") return fullSeries;
    const n = Math.max(1, parseInt(xWindow, 10) || fullSeries.length);
    return fullSeries.slice(Math.max(0, fullSeries.length - n));
  }, [fullSeries, xWindow]);

  const dataMax = useMemo(() => {
    let max = 0;
    for (const row of seriesData) {
      for (const { key } of modelKeys) {
        max = Math.max(max, Number(row[key]) || 0);
      }
    }
    return max;
  }, [seriesData, modelKeys]);

  const yDomain = useMemo((): [number, number | "auto"] => {
    if (yMax === "auto") return [0, "auto"];
    const fixed = Number(yMax);
    if (!Number.isFinite(fixed) || fixed <= 0) return [0, "auto"];
    return [0, Math.max(fixed, 1)];
  }, [yMax]);

  const hasSeries = seriesData.length > 0;

  // One tick per bucket; angle them when dense so none are dropped or clipped.
  const denseX = seriesData.length > 12;
  const xAxisProps = {
    dataKey: "label",
    tick: { fontSize: 11, fill: "rgba(255,255,255,0.45)" },
    interval: 0 as const,
    minTickGap: 0,
    tickMargin: 8,
    padding: { left: 12, right: 12 },
    ...(denseX
      ? { angle: -35, textAnchor: "end" as const, height: 56 }
      : { height: 32 }),
  };
  const chartMargin = { top: 8, right: 28, left: 0, bottom: denseX ? 16 : 4 };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">AI usage analytics</h3>
        <p className="mt-0.5 text-xs text-white/40">
          {analytics.totals.requests.toLocaleString()} requests · {analytics.totals.tokens.toLocaleString()} tokens ·
          last {analytics.periodDays} days
        </p>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <AdminPiePanel title="Requests by task" data={analytics.requestsByTask} emptyLabel="No requests logged yet" />
        <AdminPiePanel title="Requests by model" data={analytics.requestsByModel} emptyLabel="No requests logged yet" />
        <AdminPiePanel title="Tokens by task" data={analytics.tokensByTask} emptyLabel="No token usage logged yet" />
        <AdminPiePanel title="Tokens by model" data={analytics.tokensByModel} emptyLabel="No token usage logged yet" />
      </div>

      <div className={`${adminCard} p-4 md:p-5`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/45">Usage over time</p>
            <p className="mt-0.5 text-[11px] text-white/35">
              {seriesData.length} {analytics.periodDays <= 2 ? "hours" : "days"} shown
              {dataMax === 0 ? " · zeros included so empty days stay hoverable" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className={`${adminSelect} text-xs`}
              value={metric}
              onChange={(e) => setMetric(e.target.value as "requests" | "tokens")}
              aria-label="Y-axis metric"
            >
              <option value="requests">Metric: Requests</option>
              <option value="tokens">Metric: Tokens</option>
            </select>
            <select
              className={`${adminSelect} text-xs`}
              value={xWindow}
              onChange={(e) => setXWindow(e.target.value)}
              aria-label="X-axis window"
            >
              {X_WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              className={`${adminSelect} text-xs`}
              value={yMax}
              onChange={(e) => setYMax(e.target.value)}
              aria-label="Y-axis scale"
            >
              {Y_MAX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              className={`${adminSelect} text-xs`}
              value={chartType}
              onChange={(e) => setChartType(e.target.value as "line" | "area")}
              aria-label="Chart type"
            >
              <option value="area">Area chart</option>
              <option value="line">Line chart</option>
            </select>
          </div>
        </div>

        {hasSeries ? (
          <div className="h-80 w-full">
            <ResponsiveContainer>
              {chartType === "area" ? (
                <AreaChart data={seriesData} margin={chartMargin}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <XAxis {...xAxisProps} />
                  <YAxis
                    domain={yDomain}
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                    width={44}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    cursor={{ stroke: "rgba(16,185,129,0.35)", strokeWidth: 1 }}
                    formatter={(value, name) => [Number(value || 0).toLocaleString(), String(name)]}
                    labelFormatter={(label, payload) => {
                      const total = payload?.[0]?.payload?.total;
                      return total != null ? `${label} · total ${Number(total).toLocaleString()}` : String(label);
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => <span className="text-white/60">{value}</span>}
                  />
                  {modelKeys.length === 0 ? (
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.12}
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 2.5, strokeWidth: 0, fill: "#10b981" }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  ) : (
                    modelKeys.map(({ model, key, color }) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={model}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.18}
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 2.5, strokeWidth: 0, fill: color }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    ))
                  )}
                </AreaChart>
              ) : (
                <LineChart data={seriesData} margin={chartMargin}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <XAxis {...xAxisProps} />
                  <YAxis
                    domain={yDomain}
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                    width={44}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    cursor={{ stroke: "rgba(16,185,129,0.35)", strokeWidth: 1 }}
                    formatter={(value, name) => [Number(value || 0).toLocaleString(), String(name)]}
                    labelFormatter={(label, payload) => {
                      const total = payload?.[0]?.payload?.total;
                      return total != null ? `${label} · total ${Number(total).toLocaleString()}` : String(label);
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => <span className="text-white/60">{value}</span>}
                  />
                  {modelKeys.length === 0 ? (
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total"
                      stroke="#10b981"
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 2.5, strokeWidth: 0, fill: "#10b981" }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  ) : (
                    modelKeys.map(({ model, key, color }) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={model}
                        stroke={color}
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 2.5, strokeWidth: 0, fill: color }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    ))
                  )}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="flex h-80 items-center justify-center text-sm text-white/35">
            No time-series data yet — usage appears here as graph nodes invoke LLMs.
          </p>
        )}
      </div>
    </div>
  );
}
