"use client";

// Visualisations animées du dashboard de résultats. Donut via recharts ;
// funnel / KPI count-up / sentiment band en SVG+motion maison.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

// ── Count-up (rAF, ease-out) ────────────────────────────────────────────────
function useCountUp(target: number, durationMs = 900): number {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const from = ref.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * eased;
      ref.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}

export function CountUpStat({
  value,
  label,
  suffix = "",
  accent = "text-[#db2777]",
}: {
  value: number;
  label: string;
  suffix?: string;
  accent?: string;
}) {
  const v = useCountUp(value);
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 text-center">
      <p className={`text-3xl font-extrabold tracking-tight ${accent}`}>
        {Math.round(v)}
        {suffix}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
        {label}
      </p>
    </div>
  );
}

// ── Funnel de conversion ────────────────────────────────────────────────────
export function ConversionFunnel({
  stages,
}: {
  stages: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-right text-[11px] font-semibold text-[#64748b]">
              {s.label}
            </span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-[#f1f5f9]">
              <motion.div
                className="h-full rounded-lg bg-gradient-to-r from-[#f97316] to-[#db2777]"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ delay: i * 0.08, type: "spring", stiffness: 120, damping: 20 }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold text-white mix-blend-difference">
                {s.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Donut dispositions (recharts) ───────────────────────────────────────────
const DONUT_COLORS = [
  "#f97316",
  "#db2777",
  "#6366f1",
  "#16a34a",
  "#f59e0b",
  "#0ea5e9",
  "#a855f7",
  "#ef4444",
];

export function DispositionDonut({
  slices,
}: {
  slices: Array<{ label: string; value: number }>;
}) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  const totalUp = useCountUp(total);
  if (!data.length)
    return (
      <div className="flex h-44 items-center justify-center text-[12px] text-[#94a3b8]">
        —
      </div>
    );
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            stroke="none"
            animationDuration={900}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold text-[#18181b]">
          {Math.round(totalUp)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {data.map((d, i) => (
          <span key={d.label} className="inline-flex items-center gap-1.5 text-[11px] text-[#475569]">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            {d.label} ({d.value})
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Bande de sentiment ──────────────────────────────────────────────────────
export function SentimentBand({
  positive,
  neutral,
  negative,
  labels,
}: {
  positive: number;
  neutral: number;
  negative: number;
  labels: { positive: string; neutral: string; negative: string };
}) {
  const total = Math.max(1, positive + neutral + negative);
  const segs = [
    { v: positive, c: "#16a34a", e: "😀", l: labels.positive },
    { v: neutral, c: "#94a3b8", e: "😐", l: labels.neutral },
    { v: negative, c: "#ef4444", e: "😟", l: labels.negative },
  ];
  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-full bg-[#f1f5f9]">
        {segs.map((s, i) => (
          <motion.div
            key={i}
            className="flex items-center justify-center text-[11px] font-bold text-white"
            initial={{ width: 0 }}
            animate={{ width: `${(s.v / total) * 100}%` }}
            transition={{ delay: i * 0.1, type: "spring", stiffness: 120, damping: 20 }}
            style={{ backgroundColor: s.c }}
          >
            {s.v > 0 ? s.v : ""}
          </motion.div>
        ))}
      </div>
      <div className="mt-2 flex justify-around text-[11px] text-[#475569]">
        {segs.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {s.e} {s.l}
          </span>
        ))}
      </div>
    </div>
  );
}
