"use client";

import { useState, useTransition } from "react";

import { BLOCK_LABELS, type BlockId } from "@/lib/agent-prompt-defaults";
import { PLANS, type PlanKey } from "@/lib/plans";

type OrderByPlan = Record<PlanKey, BlockId[]>;

/**
 * Réorganise l'ordre des blocs du system prompt — PER-PLAN. Chaque plan
 * peut avoir sa propre séquence (ex. Premium met admin_global en tête,
 * Basique laisse persona en premier).
 *
 * Les LLM sont sensibles à l'ordre des instructions : le bloc le plus en
 * tête a tendance à dominer par effet d'ancrage. Save → PUT
 * /api/admin/settings { promptBlockOrderByPlan } → s'applique au prochain
 * appel pour les tenants du plan édité.
 */
export function BlockOrderForm({
  initialOrderByPlan,
}: {
  initialOrderByPlan: OrderByPlan;
}) {
  const [activePlan, setActivePlan] = useState<PlanKey>(PLANS[0].key);
  const [orderByPlan, setOrderByPlan] = useState<OrderByPlan>(initialOrderByPlan);
  const [savedByPlan, setSavedByPlan] = useState<OrderByPlan>(initialOrderByPlan);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const planDirty = (plan: PlanKey) =>
    JSON.stringify(orderByPlan[plan]) !== JSON.stringify(savedByPlan[plan]);
  const dirty = PLANS.some((p) => planDirty(p.key));
  const order = orderByPlan[activePlan];

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrderByPlan((prev) => ({ ...prev, [activePlan]: next }));
  };

  const reset = () =>
    setOrderByPlan((prev) => ({ ...prev, [activePlan]: savedByPlan[activePlan] }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Patch : on n'envoie que les plans modifiés.
      const patch: Partial<OrderByPlan> = {};
      for (const p of PLANS) {
        if (planDirty(p.key)) patch[p.key] = orderByPlan[p.key];
      }
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBlockOrderByPlan: patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      setSavedByPlan(orderByPlan);
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      id="block-order"
      className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
            5 · Ordre des blocs · par plan
          </p>
          <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
            Séquence indépendante par plan
          </h3>
        </div>
        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Live · prochain appel
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        Chaque plan a son propre ordre — un tenant en plan Premium peut voir
        ses blocs assemblés différemment qu&apos;un Basique. Glisse-les avec
        ↑↓ pour changer la priorité.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Plan
        </span>
        <div className="inline-flex rounded-full border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/[0.04] p-1">
          {PLANS.map((p) => {
            const isActive = activePlan === p.key;
            const showDot = planDirty(p.key);
            return (
              <button
                type="button"
                key={p.key}
                onClick={() => setActivePlan(p.key)}
                className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-white text-[var(--color-primary)] shadow-sm ring-1 ring-[var(--color-primary)]/30"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {p.name}
                {showDot && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ol className="space-y-2">
        {order.map((id, i) => (
          <li
            key={id}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 shadow-xs"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] font-mono text-xs font-semibold text-[var(--color-foreground)]">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-sm font-medium text-[var(--color-foreground)]">
              {BLOCK_LABELS[id]}
            </span>
            <code className="hidden text-[10px] text-[var(--color-muted-foreground)] sm:inline">
              {id}
            </code>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Monter"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                aria-label="Descendre"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="text-xs">
          {error ? (
            <span className="font-medium text-[var(--color-destructive)]">
              {error}
            </span>
          ) : dirty ? (
            <span className="text-[var(--color-warning)]">
              Modifications non sauvegardées
            </span>
          ) : savedAt ? (
            <span className="text-[var(--color-success)]">
              Sauvegardé à {savedAt}
            </span>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">À jour</span>
          )}
        </div>
        <div className="flex gap-2">
          {planDirty(activePlan) && (
            <button
              type="button"
              onClick={reset}
              disabled={isPending}
              className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Annuler ce plan
            </button>
          )}
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Sauvegarde…" : "Sauvegarder l'ordre"}
          </button>
        </div>
      </div>
    </form>
  );
}
