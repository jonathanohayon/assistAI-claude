"use client";

import { motion } from "motion/react";
import { fmtCompact, fmtInt } from "./format";
import type { UsageTotals } from "./types";

function Chip({
  icon,
  label,
  value,
  muted = false,
  index,
}: {
  icon: string;
  label: string;
  value: string;
  muted?: boolean;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut", delay: index * 0.04 }}
      className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 shadow-sm"
    >
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <div className="min-w-0">
        <p
          className={`font-display text-base font-bold tabular-nums leading-tight ${
            muted
              ? "text-[var(--color-muted-foreground)]"
              : "text-[var(--color-foreground)]"
          }`}
        >
          {value}
        </p>
        <p className="truncate text-[11px] text-[var(--color-muted-foreground)]">
          {label}
        </p>
      </div>
    </motion.div>
  );
}

export default function UsageStrip({ usage }: { usage: UsageTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Chip
        index={0}
        icon="📥"
        label="Minutes entrantes"
        value={fmtInt(usage.inboundMinutes)}
      />
      <Chip
        index={1}
        icon="📤"
        label="Minutes sortantes"
        value={fmtInt(usage.outboundMinutes)}
      />
      <Chip
        index={2}
        icon="💬"
        label="Messages WhatsApp"
        value={fmtInt(usage.whatsappMessages)}
      />
      <Chip
        index={3}
        icon="☎️"
        label="Numéros actifs"
        value={fmtInt(usage.activeNumbers)}
      />
      {usage.tokensTracked ? (
        <Chip
          index={4}
          icon="🔤"
          label={`Tokens OpenAI (${fmtCompact(usage.openaiOutputTokens)} sortie)`}
          value={fmtCompact(usage.openaiInputTokens)}
        />
      ) : (
        <Chip
          index={4}
          icon="🔤"
          label="Tokens OpenAI"
          value="non tracké"
          muted
        />
      )}
    </div>
  );
}
