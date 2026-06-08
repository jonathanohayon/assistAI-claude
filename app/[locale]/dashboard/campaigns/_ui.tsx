"use client";

// Petits primitives partagés par les écrans du workspace campagnes.
// Look aligné sur config-form (slate + accent chaud orange→rose).

import type { ReactNode } from "react";

export const ACCENT = "from-[#f97316] to-[#db2777]";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#334155]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#94a3b8]">{hint}</span>}
    </label>
  );
}

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#f97316] to-[#db2777] text-white">
            {icon}
          </span>
        )}
        <h4 className="text-[13px] font-bold text-[#18181b]">{title}</h4>
      </div>
      {children}
    </section>
  );
}

export const inputCls =
  "w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#18181b] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/20";

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
        active
          ? "bg-gradient-to-br from-[#f97316] to-[#db2777] text-white shadow-sm"
          : "border border-[#e2e8f0] bg-white text-[#64748b] hover:border-[#f97316]/40"
      }`}
    >
      {children}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-[#f1f5f9] text-[#475569]",
  running: "bg-[#dcfce7] text-[#166534]",
  paused: "bg-[#fef9c3] text-[#854d0e]",
  completed: "bg-[#e0e7ff] text-[#3730a3]",
  archived: "bg-[#f1f5f9] text-[#94a3b8]",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tone}`}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] motion-safe:animate-pulse" />
      )}
      {label}
    </span>
  );
}
