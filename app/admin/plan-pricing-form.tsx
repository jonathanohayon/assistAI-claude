"use client";

import { useState, useTransition } from "react";

import { PLANS } from "@/lib/plans";
import {
  PRICE_FIELDS,
  type PlanPrice,
  type PlanPricingMap,
} from "@/lib/plan-pricing";

const FIELD_LABELS: Record<keyof PlanPrice, string> = {
  eurMonthly: "EUR / mois (€)",
  eurAnnual: "EUR / an (€)",
  ilsMonthly: "ILS / mois (₪)",
  ilsAnnual: "ILS / an (₪)",
};

export function PlanPricingForm({
  initialPricing,
}: {
  initialPricing: PlanPricingMap;
}) {
  const [pricing, setPricing] = useState<PlanPricingMap>(initialPricing);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = (
    plan: keyof PlanPricingMap,
    field: keyof PlanPrice,
    value: string,
  ) => {
    const n = value === "" ? 0 : Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    setPricing((p) => ({
      ...p,
      [plan]: { ...p[plan], [field]: n },
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
        body: JSON.stringify({ planPricing: pricing }),
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
              Tarifs des plans
            </p>
            <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
              Grille tarifaire (EUR + ILS)
            </h3>
          </div>
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Live · prochain paiement + dashboard reload
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Montant total facturé par période. La devise réelle suit la langue du
          tenant (hébreu → ₪, sinon → €). Le montant est résolu côté serveur au
          moment du paiement HYP — jamais depuis le navigateur.
        </p>

        <div className="-mx-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <th className="px-2 py-2 font-medium">Plan</th>
                {PRICE_FIELDS.map((f) => (
                  <th key={f} className="px-2 py-2 font-medium">
                    {FIELD_LABELS[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLANS.map((plan) => (
                <tr
                  key={plan.key}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-2.5 font-medium text-[var(--color-foreground)]">
                    {plan.name}
                    <span className="ml-1 text-[10px] text-[var(--color-muted-foreground)]">
                      {plan.key}
                    </span>
                  </td>
                  {PRICE_FIELDS.map((f) => (
                    <td key={f} className="px-2 py-2.5">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={pricing[plan.key][f]}
                        onChange={(e) => update(plan.key, f, e.target.value)}
                        className="w-24 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : savedAt ? (
              <span className="text-emerald-700">Enregistré à {savedAt}</span>
            ) : dirty ? (
              "Modifications non enregistrées"
            ) : (
              "À jour"
            )}
          </p>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : "Enregistrer les tarifs"}
          </button>
        </div>
      </div>
    </form>
  );
}
