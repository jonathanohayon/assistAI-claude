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

  // ── Drag and drop natif HTML5 ────────────────────────────────────────
  // Pas de lib externe pour rester light. Le pattern :
  //   - draggable={true} sur chaque <li>
  //   - onDragStart capture l'index source
  //   - onDragOver preventDefault pour autoriser le drop
  //   - onDragEnter → setDragOverIndex pour afficher l'indicateur ligne
  //   - onDrop → splice array et réécrit l'état
  //   - onDragEnd → reset
  // L'item en cours de drag passe en opacity-40 ; un trait magenta indique
  // l'insertion juste au-dessus de l'item survolé.
  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const onDragStart = (i: number) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragSrcIndex(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  };
  const onDragEnter = (i: number) => () => {
    if (dragSrcIndex == null || dragSrcIndex === i) {
      setDragOverIndex(null);
      return;
    }
    setDragOverIndex(i);
  };
  const onDragOver = (e: React.DragEvent<HTMLLIElement>) => {
    // preventDefault est OBLIGATOIRE pour que onDrop déclenche
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (target: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragSrcIndex == null || dragSrcIndex === target) {
      setDragSrcIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(dragSrcIndex, 1);
    if (moved) next.splice(target, 0, moved);
    setOrderByPlan((prev) => ({ ...prev, [activePlan]: next }));
    setDragSrcIndex(null);
    setDragOverIndex(null);
  };
  const onDragEnd = () => {
    setDragSrcIndex(null);
    setDragOverIndex(null);
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
        ses blocs assemblés différemment qu&apos;un Basique. <strong>Drag &amp;
        drop</strong> les lignes pour réordonner (ou utilise ↑↓ pour le clavier).
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
        {order.map((id, i) => {
          const isDragging = dragSrcIndex === i;
          const isDropTarget = dragOverIndex === i;
          return (
            <li
              key={id}
              draggable
              onDragStart={onDragStart(i)}
              onDragEnter={onDragEnter(i)}
              onDragOver={onDragOver}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              className={`relative flex select-none items-center gap-3 rounded-xl border bg-white px-3 py-2.5 shadow-xs transition-all ${
                isDragging
                  ? "border-[#ec4899] opacity-50 ring-2 ring-[#ec4899]/30"
                  : isDropTarget
                    ? "border-[#ec4899] shadow-[0_0_0_3px_rgba(236,72,153,0.18)]"
                    : "border-[var(--color-border)] hover:border-[#ec4899]/40 hover:shadow-sm"
              }`}
            >
              {/* Drop indicator : trait magenta au-dessus de l'item ciblé */}
              {isDropTarget && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-1 left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#22d3ee]"
                />
              )}

              {/* Drag handle — curseur grab/grabbing pour signaler l'interaction */}
              <span
                aria-hidden
                className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-[#94a3b8] active:cursor-grabbing"
                title="Maintiens et glisse pour réordonner"
              >
                <svg viewBox="0 0 10 16" fill="currentColor" className="h-4 w-3">
                  <circle cx="2" cy="3" r="1.3" />
                  <circle cx="8" cy="3" r="1.3" />
                  <circle cx="2" cy="8" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="2" cy="13" r="1.3" />
                  <circle cx="8" cy="13" r="1.3" />
                </svg>
              </span>

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
          );
        })}
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
