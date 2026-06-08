"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { fmtUsd } from "./format";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  planLabel,
  type TenantCost,
} from "./types";

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

// Panneau de détail dépliable : ventilation du coût par catégorie + lien
// vers la fiche finance complète du tenant.
function TenantBreakdown({ t }: { t: TenantCost }) {
  const total = t.cost.total || 1;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="px-4 py-4">
        {/* Barre empilée proportionnelle */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-border)]/60">
          {CATEGORY_ORDER.map((k) => {
            const v = t.cost[k];
            if (v <= 0) return null;
            return (
              <div
                key={k}
                title={`${CATEGORY_LABELS[k]} · ${fmtUsd(v)}`}
                style={{
                  width: `${(v / total) * 100}%`,
                  backgroundColor: CATEGORY_COLORS[k],
                }}
              />
            );
          })}
        </div>

        {/* Détail par catégorie */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_ORDER.map((k) => {
            const v = t.cost[k];
            const pct = t.cost.total > 0 ? Math.round((v / t.cost.total) * 100) : 0;
            return (
              <div
                key={k}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-white px-3 py-2"
              >
                <span className="inline-flex items-center gap-2 text-[13px] text-[var(--color-foreground)]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[k] }}
                  />
                  {CATEGORY_LABELS[k]}
                </span>
                <span className="tabular-nums text-[13px] font-medium text-[var(--color-foreground)]">
                  {fmtUsd(v)}
                  <span className="ml-1 text-[11px] font-normal text-[var(--color-muted-foreground)]">
                    {pct}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[var(--color-muted-foreground)]">
            Revenu {fmtUsd(t.revenueUsd)} · Marge{" "}
            <span
              className={
                t.marginUsd >= 0 ? "text-[#059669]" : "text-[#dc2626]"
              }
            >
              {fmtUsd(t.marginUsd)}
            </span>
          </span>
          <Link
            href={`/admin/users/${t.userId}/finance`}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/5"
          >
            Voir la fiche finance complète →
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

export default function TenantsTable({ tenants }: { tenants: TenantCost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
              <th className="w-8 px-2 py-3" aria-hidden />
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
              const isOpen = expandedId === t.userId;
              return (
                <Fragment key={t.userId}>
                  <tr
                    onClick={() =>
                      setExpandedId((cur) => (cur === t.userId ? null : t.userId))
                    }
                    aria-expanded={isOpen}
                    className={`cursor-pointer border-b border-[var(--color-border)]/60 transition-colors hover:bg-[var(--color-muted)]/30 ${
                      isOpen ? "bg-[var(--color-muted)]/30" : ""
                    }`}
                  >
                    <td className="px-2 py-3 text-center text-[var(--color-muted-foreground)]">
                      <span
                        aria-hidden
                        className={`inline-block transition-transform ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        ›
                      </span>
                    </td>
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
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <tr className="border-b border-[var(--color-border)]/60 bg-[var(--color-muted)]/15">
                        <td colSpan={6} className="p-0">
                          <TenantBreakdown t={t} />
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
