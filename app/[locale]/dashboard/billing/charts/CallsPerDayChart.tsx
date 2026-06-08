"use client";

import { motion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface CallsPerDayChartProps {
  data: { date: string; inbound: number; outbound: number }[];
  title: string;
  inboundLabel: string;
  outboundLabel: string;
  emptyLabel: string;
}

/**
 * Format an ISO date string ("YYYY-MM-DD") to a short day label like "12/06".
 * Parsed manually to avoid timezone shifts and any date library dependency.
 */
function formatDayTick(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [, month, day] = parts;
  if (!month || !day) return iso;
  return `${day}/${month}`;
}

export default function CallsPerDayChart({
  data,
  title,
  inboundLabel,
  outboundLabel,
  emptyLabel,
}: CallsPerDayChartProps) {
  const hasData =
    data.length > 0 &&
    data.some((d) => (d.inbound ?? 0) > 0 || (d.outbound ?? 0) > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm"
    >
      <h3 className="mb-4 text-sm font-semibold text-[var(--color-foreground)]">
        {title}
      </h3>

      {hasData ? (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayTick}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              cursor={{ fill: "var(--color-border)", opacity: 0.25 }}
              labelFormatter={(label) => formatDayTick(String(label))}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              labelStyle={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-foreground)",
              }}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{
                fontSize: 12,
                color: "var(--color-muted-foreground)",
                paddingTop: 8,
              }}
            />
            <Bar
              dataKey="inbound"
              name={inboundLabel}
              stackId="calls"
              fill="var(--color-primary)"
              radius={[0, 0, 0, 0]}
              maxBarSize={48}
            />
            <Bar
              dataKey="outbound"
              name={outboundLabel}
              stackId="calls"
              fill="var(--color-accent)"
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[240px] items-center justify-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {emptyLabel}
          </p>
        </div>
      )}
    </motion.div>
  );
}
