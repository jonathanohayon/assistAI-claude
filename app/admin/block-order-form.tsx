"use client";

import { useState, useTransition } from "react";

import { BLOCK_LABELS, type BlockId } from "@/lib/agent-prompt-defaults";

/**
 * Réorganise l'ordre des blocs du system prompt envoyé à OpenAI Realtime.
 * 7 blocs fixes (on n'en ajoute/supprime pas — il faut chacun pour que
 * l'agent fonctionne). L'admin les déplace haut/bas avec ↑↓.
 *
 * Le bloc déplacé garde sa source/contenu (qui vient soit de app_settings
 * pour les directives système, soit de agent_configs/calculé pour le
 * persona/langue), seul son OFFSET dans le system prompt change.
 *
 * Save → POST /api/admin/settings { promptBlockOrder } → s'applique au
 * prochain appel.
 */
export function BlockOrderForm({
  initialOrder,
}: {
  initialOrder: BlockId[];
}) {
  const [order, setOrder] = useState<BlockId[]>(initialOrder);
  // savedOrder = baseline du "à jour" — mis à jour après chaque save
  // réussi, sinon dirty resterait true pour toujours (initialOrder ne
  // bouge jamais, c'est un prop figé au mount).
  const [savedOrder, setSavedOrder] = useState<BlockId[]>(initialOrder);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = JSON.stringify(order) !== JSON.stringify(savedOrder);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  };

  const reset = () => setOrder(savedOrder);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBlockOrder: order }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      // Met à jour la baseline → dirty redevient false sans refetch.
      setSavedOrder(order);
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
            5 · Ordre des blocs du system prompt
          </p>
          <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
            Séquence injectée dans OpenAI Realtime
          </h3>
        </div>
        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Live · prochain appel
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        Les LLM sont sensibles à l&apos;ordre des instructions. Le bloc le
        plus en tête a tendance à dominer par effet d&apos;ancrage. Les
        7 blocs ci-dessous sont assemblés dans cet ordre par{" "}
        <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
          /api/agent/config
        </code>{" "}
        à chaque appel. Glisse-les avec ↑↓ pour changer la priorité.
      </p>

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
          {dirty && (
            <button
              type="button"
              onClick={reset}
              disabled={isPending}
              className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Annuler
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
