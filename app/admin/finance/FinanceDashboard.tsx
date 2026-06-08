"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ByPlanBar,
  CategoryDonut,
  ChartCard,
  CostOverTimeChart,
} from "./charts";
import KpiCards from "./KpiCards";
import RateCardForm from "./RateCardForm";
import TenantsTable from "./TenantsTable";
import UsageStrip from "./UsageStrip";
import type { FinanceStats, Granularity } from "./types";

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "Jour" },
  { value: "month", label: "Mois" },
  { value: "year", label: "Année" },
];

// ── Badge "Estimé" avec tooltip ──────────────────────────────────────────────
function EstimatedBadge() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label="Coûts estimés — plus d'informations"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-800"
      >
        <span aria-hidden>≈</span> Estimé
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-[10px]"
        >
          ?
        </span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border border-[var(--color-border)] bg-white p-3 text-[12px] leading-relaxed text-[var(--color-foreground)] shadow-lg"
          >
            Coûts OpenAI estimés à partir des minutes d&apos;appel — les tokens
            réels seront utilisés dès que le worker les remonte.
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ── Toggle de granularité ────────────────────────────────────────────────────
function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Granularité temporelle"
      className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]/60 p-1"
    >
      {GRANULARITIES.map((g) => {
        const active = g.value === value;
        return (
          <button
            key={g.value}
            type="button"
            onClick={() => onChange(g.value)}
            aria-pressed={active}
            className="relative rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors"
          >
            {active ? (
              <motion.span
                layoutId="granularity-pill"
                className="absolute inset-0 rounded-full bg-white shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            ) : null}
            <span
              className={`relative z-10 ${
                active
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-muted-foreground)]"
              }`}
            >
              {g.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Skeleton de chargement ───────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50"
          />
        ))}
      </div>
      <div className="h-[340px] animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[320px] animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50" />
        <div className="h-[320px] animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50" />
      </div>
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return "";
  return `${dateFmt.format(f)} → ${dateFmt.format(t)}`;
}

export default function FinanceDashboard({ userId }: { userId?: string }) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const fetchStats = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ granularity });
      if (userId) params.set("userId", userId);
      const res = await fetch(`/api/admin/finance-stats?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FinanceStats;
      if (id === reqId.current) setStats(json);
    } catch (e) {
      if (id === reqId.current) {
        setError(
          e instanceof Error
            ? e.message
            : "Erreur lors du chargement des données.",
        );
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [granularity, userId]);

  useEffect(() => {
    // Fetch async : les setState significatifs s'exécutent après l'await
    // (synchro depuis un système externe). On désactive la règle qui ne
    // distingue pas le cas async légitime.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStats();
  }, [fetchStats]);

  const isGlobal = !userId;
  const isEmpty =
    !!stats &&
    stats.totals.total === 0 &&
    stats.revenueUsd === 0 &&
    stats.series.length === 0;

  return (
    <div className="space-y-5">
      {/* En-tête : titre + range + estimé + toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-[var(--color-foreground)]">
            Finance
          </h2>
          {stats?.estimated ? <EstimatedBadge /> : null}
          {stats ? (
            <span className="text-[12px] text-[var(--color-muted-foreground)]">
              {formatRange(stats.range.from, stats.range.to)}
            </span>
          ) : null}
        </div>
        <GranularityToggle value={granularity} onChange={setGranularity} />
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm font-medium text-red-700">
            Impossible de charger les données financières.
          </p>
          <p className="text-[12px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void fetchStats()}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Réessayer
          </button>
        </div>
      ) : loading && !stats ? (
        <LoadingSkeleton />
      ) : stats ? (
        <>
          {isEmpty ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white p-10 text-center">
              <span aria-hidden className="text-3xl">
                📊
              </span>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                Aucune donnée financière sur cette période.
              </p>
              <p className="text-[12px] text-[var(--color-muted-foreground)]">
                Les coûts apparaîtront dès les premiers appels et abonnements.
              </p>
            </div>
          ) : (
            <motion.div
              className={`space-y-5 transition-opacity ${
                loading ? "opacity-60" : "opacity-100"
              }`}
            >
              {/* KPIs */}
              <KpiCards stats={stats} />

              {/* Coûts dans le temps */}
              <ChartCard title="Coûts dans le temps" delay={0.05}>
                <CostOverTimeChart
                  series={stats.series}
                  granularity={granularity}
                  emptyLabel="Pas encore de données sur cette période."
                />
              </ChartCard>

              {/* Donut + barres par formule */}
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Répartition par catégorie" delay={0.1}>
                  <CategoryDonut
                    byCategory={stats.byCategory}
                    emptyLabel="Aucun coût à répartir."
                  />
                </ChartCard>
                <ChartCard title="Coûts par formule" delay={0.15}>
                  <ByPlanBar
                    byPlan={stats.byPlan}
                    emptyLabel="Aucune formule active."
                  />
                </ChartCard>
              </div>

              {/* Usage */}
              <div>
                <h3 className="mb-2 font-display text-sm font-semibold text-[var(--color-foreground)]">
                  Usage sur la période
                </h3>
                <UsageStrip usage={stats.usage} />
              </div>

              {/* Tenants (global uniquement) */}
              {isGlobal ? (
                <div>
                  <h3 className="mb-2 font-display text-sm font-semibold text-[var(--color-foreground)]">
                    Coût par tenant
                  </h3>
                  <TenantsTable tenants={stats.tenants} />
                </div>
              ) : null}

              {/* Grille tarifaire */}
              <RateCardForm onSaved={() => void fetchStats()} />
            </motion.div>
          )}
        </>
      ) : null}
    </div>
  );
}
