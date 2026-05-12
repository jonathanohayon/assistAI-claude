"use client";

import { useState, useTransition } from "react";

import { PLANS } from "@/lib/plans";
import {
  FEATURE_DEFS,
  type FeatureKey,
  type PlanFeatureMatrix,
} from "@/lib/plan-features";

export function PlanFeaturesForm({
  initialMatrix,
}: {
  initialMatrix: PlanFeatureMatrix;
}) {
  const [matrix, setMatrix] = useState<PlanFeatureMatrix>(initialMatrix);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (plan: keyof PlanFeatureMatrix, feature: FeatureKey) => {
    setMatrix((m) => ({
      ...m,
      [plan]: { ...m[plan], [feature]: !m[plan][feature] },
    }));
    setDirty(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planFeatures: matrix }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
      setDirty(false);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
              3 · Features activées par plan
            </p>
            <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
              Matrice plan × feature
            </h3>
          </div>
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Live · prochain appel + prochain dashboard reload
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Coche les features que chaque plan a le droit d&apos;utiliser. Une
          feature désactivée masque l&apos;onglet correspondant côté tenant
          ET retire les tools associés de l&apos;agent vocal.
        </p>

        <div className="-mx-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <th className="px-2 py-2 font-medium">Feature</th>
                {PLANS.map((p) => (
                  <th
                    key={p.key}
                    className="px-2 py-2 text-center font-medium"
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_DEFS.map((f) => (
                <tr
                  key={f.key}
                  className="border-t border-[var(--color-border)]/60"
                >
                  <td className="px-2 py-3 align-top">
                    <div className="font-medium text-[var(--color-foreground)]">
                      {f.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                      {f.description}
                    </div>
                  </td>
                  {PLANS.map((p) => {
                    const checked = matrix[p.key][f.key];
                    return (
                      <td key={p.key} className="px-2 py-3 text-center">
                        <label className="inline-flex cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(p.key, f.key)}
                            className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-4 z-30">
        <div className="flex items-center justify-between gap-4 rounded-full border border-[var(--color-border)] bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
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
              <span className="text-[var(--color-muted-foreground)]">
                À jour
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </form>
  );
}
