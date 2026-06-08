"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface OutcomeDonutProps {
  data: { label: string; value: number; color?: string }[];
  title: string;
  emptyLabel: string;
}

const PALETTE = [
  "#6366f1",
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#64748b",
];

export default function OutcomeDonut({
  data,
  title,
  emptyLabel,
}: OutcomeDonutProps) {
  const total = useMemo(
    () => data.reduce((sum, d) => sum + (d.value || 0), 0),
    [data],
  );

  const isEmpty = data.length === 0 || total === 0;

  const slices = useMemo(
    () =>
      data.map((d, i) => ({
        ...d,
        color: d.color ?? PALETTE[i % PALETTE.length],
      })),
    [data],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border border-slate-200 bg-white p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>

      {isEmpty ? (
        <div className="flex h-[240px] items-center justify-center">
          <p className="text-sm text-slate-400">{emptyLabel}</p>
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive
              >
                {slices.map((slice) => (
                  <Cell key={slice.label} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                }}
                formatter={(value, name) => [value, name]}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value, entry) => {
                  const payload = entry?.payload as
                    | { value?: number }
                    | undefined;
                  return (
                    <span className="text-slate-600">
                      {value}
                      {payload?.value != null ? ` (${payload.value})` : ""}
                    </span>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Center total in the donut hole. Legend reserves the bottom band,
              so the donut sits in the top ~85% — match that to align the label. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[85%] flex-col items-center justify-center">
            <span className="text-2xl font-bold leading-none text-slate-900">
              {total.toLocaleString()}
            </span>
            <span className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
              total
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
