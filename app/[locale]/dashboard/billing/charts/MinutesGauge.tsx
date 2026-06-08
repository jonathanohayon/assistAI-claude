"use client";

import { motion } from "motion/react";
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";

export interface MinutesGaugeProps {
  used: number;
  included: number;
  title: string;
  usedLabel: string;
  includedLabel: string;
  overageLabel?: string;
}

export function MinutesGauge({
  used,
  included,
  title,
  usedLabel,
  includedLabel,
  overageLabel,
}: MinutesGaugeProps) {
  const roundedUsed = Math.round(used);
  const roundedIncluded = Math.round(included);

  const isOver = roundedIncluded > 0 && roundedUsed > roundedIncluded;
  const isAtLimit =
    roundedIncluded > 0 && roundedUsed >= roundedIncluded && !isOver;

  const ratio = roundedIncluded > 0 ? roundedUsed / roundedIncluded : 0;
  const percent = Math.round(Math.min(ratio, 1) * 100);

  // Color logic: brand gradient when healthy, amber near/at limit, red when over.
  const barFill = isOver
    ? "#ef4444"
    : isAtLimit
      ? "#f59e0b"
      : "url(#minutesGaugeBrandGradient)";

  const bigNumberColor = isOver
    ? "#ef4444"
    : "var(--color-foreground)";

  const data = [
    {
      name: title,
      value: percent,
      fill: barFill,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center rounded-2xl border p-5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-background, transparent)",
      }}
    >
      <h3
        className="mb-1 text-sm font-medium tracking-wide"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {title}
      </h3>

      <div className="relative h-[200px] w-full">
        <ResponsiveContainer width="100%" height={200}>
          <RadialBarChart
            innerRadius="74%"
            outerRadius="100%"
            barSize={16}
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <defs>
              <linearGradient
                id="minutesGaugeBrandGradient"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--color-primary)" />
                <stop offset="100%" stopColor="var(--color-accent)" />
              </linearGradient>
            </defs>

            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />

            <RadialBar
              background={{ fill: "#e5e7eb" }}
              dataKey="value"
              cornerRadius={999}
              isAnimationActive
              animationDuration={900}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* Center overlay */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-3xl font-bold leading-none tabular-nums"
            style={{ color: bigNumberColor }}
          >
            {roundedUsed.toLocaleString()}
          </span>
          <span
            className="mt-1 text-xs font-medium tabular-nums"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            / {roundedIncluded.toLocaleString()} {includedLabel}
          </span>
        </div>
      </div>

      <span
        className="mt-2 text-xs"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {usedLabel}
      </span>

      {isOver && overageLabel ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            color: "#ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.12)",
          }}
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "#ef4444" }}
          />
          {overageLabel}
        </motion.span>
      ) : null}
    </motion.div>
  );
}

export default MinutesGauge;
