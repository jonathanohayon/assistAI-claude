"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { fmtUsd } from "./format";
import { planLabel, type TenantCost } from "./types";

type SortKey = "cost" | "revenue" | "margin" | "name";

const PLAN_BADGE: Record<string, string> = {
  whatsapp: "bg-[#25D366]/12 text-[#15803d] border-[#25D366]/30",
  global: "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/25",
  premium: "bg-[#a855f7]/10 text-[#7c3aed] border-[#a855f7]/25",
};

function PlanBadge({ plan }: { plan: string }) {
  const cls =
    PLAN_BADGE[plan] ??
    "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border-[var(--color-border)]";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {planLabel(plan)}
    </span>
  );
}

function HeaderButton({
  label,
  active,
  align = "right",
  onClick,
}: {
  label: string;
  active: boolean;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-[var(--color-primary)] ${
        active
          ? "text-[var(--color-primary)]"
          : "text-[var(--color-muted-foreground)]"
      } ${align === "right" ? "justify-end" : ""}`}
    >
      {label}
      <span aria-hidden className={active ? "opacity-100" : "opacity-30"}>
        ↓
      </span>
    </button>
  );
}

export default function TenantsTable({ tenants }: { tenants: TenantCost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");

  const sorted = useMemo(() => {
    const arr = [...tenants];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "revenue":
          return b.revenueUsd - a.revenueUsd;
        case "margin":
          return b.marginUsd - a.marginUsd;
        case "name":
          return (a.displayName || a.email).localeCompare(
            b.displayName || b.email,
            "fr",
          );
        case "cost":
        default:
          return b.cost.total - a.cost.total;
      }
    });
    return arr;
  }, [tenants, sortKey]);

  if (!tenants.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Aucun tenant sur cette période.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/40">
              <th
                className="px-4 py-3 text-left"
                aria-sort={sortKey === "name" ? "descending" : "none"}
              >
                <HeaderButton
                  label="Tenant"
                  align="left"
                  active={sortKey === "name"}
                  onClick={() => setSortKey("name")}
                />
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Formule
              </th>
              <th
                className="px-4 py-3 text-right"
                aria-sort={sortKey === "cost" ? "descending" : "none"}
              >
                <HeaderButton
                  label="Coût total"
                  active={sortKey === "cost"}
                  onClick={() => setSortKey("cost")}
                />
              </th>
              <th
                className="px-4 py-3 text-right"
                aria-sort={sortKey === "revenue" ? "descending" : "none"}
              >
                <HeaderButton
                  label="Revenu"
                  active={sortKey === "revenue"}
                  onClick={() => setSortKey("revenue")}
                />
              </th>
              <th
                className="px-4 py-3 text-right"
                aria-sort={sortKey === "margin" ? "descending" : "none"}
              >
                <HeaderButton
                  label="Marge"
                  active={sortKey === "margin"}
                  onClick={() => setSortKey("margin")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const marginPositive = t.marginUsd >= 0;
              return (
                <tr
                  key={t.userId}
                  className="border-b border-[var(--color-border)]/60 transition-colors last:border-0 hover:bg-[var(--color-muted)]/30"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--color-foreground)]">
                      {t.displayName || "—"}
                    </p>
                    <p className="text-[12px] text-[var(--color-muted-foreground)]">
                      {t.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <PlanBadge plan={t.plan} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-[var(--color-foreground)]">
                    {fmtUsd(t.cost.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
                    {fmtUsd(t.revenueUsd)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      marginPositive ? "text-[#059669]" : "text-[#dc2626]"
                    }`}
                  >
                    {fmtUsd(t.marginUsd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
