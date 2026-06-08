"use client";

import { motion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SpendChartProps {
  data: { date: string; amount: number }[];
  currencySymbol: string;
  title: string;
  emptyLabel: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format an ISO date string to a short "MMM YY" label, e.g. "Jan 26". */
function formatTick(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yy = String(d.getFullYear()).slice(-2);
  return `${MONTHS[d.getMonth()]} ${yy}`;
}

/** Format an amount with the currency symbol after the number, e.g. "129 ₪". */
function formatAmount(value: number, symbol: string): string {
  return `${value} ${symbol}`;
}

const GRADIENT_ID = "spend-chart-gradient";

export default function SpendChart({
  data,
  currencySymbol,
  title,
  emptyLabel,
}: SpendChartProps) {
  const isEmpty = !data || data.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border bg-white p-4"
    >
      <h3 className="mb-4 text-sm font-medium text-[var(--color-foreground,inherit)]">
        {title}
      </h3>

      {isEmpty ? (
        <div className="flex h-[240px] items-center justify-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {emptyLabel}
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" />
                <stop offset="100%" stopColor="var(--color-accent)" />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value: number) =>
                formatAmount(value, currencySymbol)
              }
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-border)", opacity: 0.3 }}
              formatter={(value) =>
                formatAmount(Number(value), currencySymbol)
              }
              labelFormatter={(label) => formatTick(String(label))}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="amount"
              fill={`url(#${GRADIENT_ID})`}
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </motion.div>
  );
}
