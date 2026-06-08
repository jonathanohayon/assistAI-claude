"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtUsd, fmtUsdPrecise, formatPeriod, useCountUp } from "./format";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type CostBucket,
  type CostCategoryKey,
  type FinanceStats,
  type Granularity,
  planLabel,
} from "./types";

// ── Wrapper carte (motion fade-in) ───────────────────────────────────────────
export function ChartCard({
  title,
  children,
  className = "",
  delay = 0,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
      className={`rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-[var(--color-foreground)]">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </motion.div>
  );
}

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  fontSize: 12,
  boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
} as const;

// ── Coûts dans le temps : barres empilées par catégorie + ligne de revenu ────
type TooltipPayloadItem = {
  dataKey?: string | number;
  value?: number;
  color?: string;
  name?: string;
};

function StackedTooltip({
  active,
  payload,
  label,
  granularity,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  granularity: Granularity;
}) {
  if (!active || !payload?.length) return null;
  const cats = payload.filter(
    (p) => p.dataKey !== "revenueUsd" && (p.value ?? 0) > 0,
  );
  const revenue = payload.find((p) => p.dataKey === "revenueUsd");
  const total = cats.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div
      style={TOOLTIP_STYLE}
      className="bg-white p-3 text-[12px] text-[var(--color-foreground)]"
    >
      <p className="mb-1.5 font-semibold">
        {formatPeriod(String(label), granularity)}
      </p>
      <div className="space-y-1">
        {cats.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-[var(--color-muted-foreground)]">
              {CATEGORY_LABELS[p.dataKey as CostCategoryKey] ?? p.name}
            </span>
            <span className="ml-auto font-medium tabular-nums">
              {fmtUsdPrecise(p.value ?? 0)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 border-t border-[var(--color-border)] pt-1">
          <span className="font-semibold">Total</span>
          <span className="ml-auto font-bold tabular-nums">
            {fmtUsd(total)}
          </span>
        </div>
        {revenue && (revenue.value ?? 0) > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">Revenu</span>
            <span className="ml-auto font-medium tabular-nums text-[var(--color-primary)]">
              {fmtUsd(revenue.value ?? 0)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CostOverTimeChart({
  series,
  granularity,
  emptyLabel,
}: {
  series: CostBucket[];
  granularity: Granularity;
  emptyLabel: string;
}) {
  const isEmpty =
    series.length === 0 || series.every((b) => b.total === 0);
  const hasRevenue = series.some((b) => b.revenueUsd > 0);

  if (isEmpty) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="var(--color-border)"
        />
        <XAxis
          dataKey="period"
          tickFormatter={(v: string) => formatPeriod(v, granularity)}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => fmtUsd(v)}
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "var(--color-border)", opacity: 0.25 }}
          content={(props) => (
            <StackedTooltip
              {...(props as object)}
              granularity={granularity}
            />
          )}
        />
        {CATEGORY_ORDER.map((cat, i) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="cost"
            fill={CATEGORY_COLORS[cat]}
            maxBarSize={48}
            radius={
              i === CATEGORY_ORDER.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]
            }
            animationDuration={700}
          />
        ))}
        {hasRevenue ? (
          <Line
            type="monotone"
            dataKey="revenueUsd"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
            animationDuration={700}
          />
        ) : null}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut par catégorie ──────────────────────────────────────────────────────
export function CategoryDonut({
  byCategory,
  emptyLabel,
}: {
  byCategory: { category: string; amount: number }[];
  emptyLabel: string;
}) {
  const slices = useMemo(
    () =>
      byCategory
        .filter((c) => c.amount > 0)
        .map((c) => {
          const key = c.category as CostCategoryKey;
          return {
            key,
            label: CATEGORY_LABELS[key] ?? c.category,
            value: c.amount,
            color: CATEGORY_COLORS[key] ?? "#94a3b8",
          };
        }),
    [byCategory],
  );
  const total = useMemo(
    () => slices.reduce((s, d) => s + d.value, 0),
    [slices],
  );
  const totalUp = useCountUp(total);

  if (!slices.length) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="none"
            animationDuration={800}
          >
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [
              fmtUsdPrecise(value),
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[220px] flex-col items-center justify-center">
        <span className="font-display text-xl font-extrabold leading-none tabular-nums text-[var(--color-foreground)]">
          {fmtUsd(totalUp)}
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
          coût total
        </span>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
        {slices.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-foreground)]"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
            <span className="tabular-nums text-[var(--color-muted-foreground)]">
              {fmtUsd(s.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Barres par formule (plan) ────────────────────────────────────────────────
const PLAN_COLORS = ["#db2777", "#22d3ee", "#10b981", "#f59e0b", "#a855f7"];

export function ByPlanBar({
  byPlan,
  emptyLabel,
}: {
  byPlan: FinanceStats["byPlan"];
  emptyLabel: string;
}) {
  const data = useMemo(
    () =>
      byPlan
        .filter((p) => p.amount > 0)
        .map((p) => ({ name: planLabel(p.plan), amount: p.amount })),
    [byPlan],
  );

  if (!data.length) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 56)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          horizontal={false}
          stroke="var(--color-border)"
        />
        <XAxis
          type="number"
          tickFormatter={(v: number) => fmtUsd(v)}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={96}
          tick={{ fill: "var(--color-foreground)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "var(--color-border)", opacity: 0.25 }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number) => [fmtUsd(value), "Coût"]}
        />
        <Bar dataKey="amount" radius={[0, 8, 8, 0]} maxBarSize={40} animationDuration={700}>
          {data.map((_, i) => (
            <Cell key={i} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
