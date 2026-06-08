"use client";

import { motion } from "motion/react";
import { fmtUsd, useCountUp } from "./format";
import type { FinanceStats } from "./types";

// Carte KPI animée (count-up sur la valeur USD).
function KpiCard({
  label,
  value,
  accent,
  icon,
  index,
  sub,
}: {
  label: string;
  value: number;
  accent: string;
  icon: string;
  index: number;
  sub?: string;
}) {
  const animated = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: index * 0.05 }}
      className="group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 blur-xl transition-opacity group-hover:opacity-20"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {label}
        </p>
        <span aria-hidden className="text-base leading-none opacity-70">
          {icon}
        </span>
      </div>
      <p
        className="mt-2 font-display text-2xl font-extrabold tabular-nums tracking-tight"
        style={{ color: accent }}
      >
        {fmtUsd(animated)}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
          {sub}
        </p>
      ) : null}
    </motion.div>
  );
}

export default function KpiCards({ stats }: { stats: FinanceStats }) {
  const { totals, revenueUsd, marginUsd } = stats;
  const twilioCombined = totals.twilioVoice + totals.twilioNumbers;
  const marginPositive = marginUsd >= 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        index={0}
        label="Coût total"
        value={totals.total}
        accent="#1e2937"
        icon="💸"
      />
      <KpiCard
        index={1}
        label="OpenAI"
        value={totals.openai}
        accent="#10b981"
        icon="🤖"
      />
      <KpiCard
        index={2}
        label="Twilio"
        value={twilioCombined}
        accent="#0e7490"
        icon="📞"
        sub="voix + numéros"
      />
      <KpiCard
        index={3}
        label="WhatsApp"
        value={totals.whatsapp}
        accent="#25D366"
        icon="💬"
      />
      <KpiCard
        index={4}
        label="Revenu"
        value={revenueUsd}
        accent="#db2777"
        icon="📈"
      />
      <KpiCard
        index={5}
        label="Marge"
        value={marginUsd}
        accent={marginPositive ? "#059669" : "#dc2626"}
        icon={marginPositive ? "✅" : "⚠️"}
      />
    </div>
  );
}
