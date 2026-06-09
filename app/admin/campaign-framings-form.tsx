"use client";

import { useEffect, useState, useTransition } from "react";

import { GOAL_PRESETS, type GoalPreset } from "@/lib/campaigns/constants";

const PRESET_LABEL: Record<GoalPreset, string> = {
  cold: "Appel à froid (cold)",
  sales: "Vente (sales)",
  lead_gen: "Génération de leads (lead_gen)",
  marketing: "Marketing",
  custom: "Personnalisé (custom)",
};

type Framings = Record<GoalPreset, string>;

export function CampaignFramingsForm() {
  const [framings, setFramings] = useState<Framings | null>(null);
  const [defaults, setDefaults] = useState<Framings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/campaign-framings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: { framings: Framings; defaults: Framings }) => {
        if (cancelled) return;
        setFramings(d.framings);
        setDefaults(d.defaults);
      })
      .catch(() => {
        if (!cancelled) setError("Chargement impossible.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreset = (preset: GoalPreset, value: string) => {
    setFramings((f) => (f ? { ...f, [preset]: value } : f));
    setDirty(true);
  };

  const resetPreset = (preset: GoalPreset) => {
    if (!defaults) return;
    setPreset(preset, defaults[preset]);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!framings) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/campaign-framings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framings }),
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
              Campagnes sortantes
            </p>
            <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
              Prompt de l&apos;agent par objectif (sales / marketing / …)
            </h3>
          </div>
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Live · prochain appel de campagne
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Texte de cadrage injecté dans le system prompt de l&apos;agent vocal
          selon le preset de la campagne. Vide = on retombe sur le défaut.
        </p>

        {!framings ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Chargement…</p>
        ) : (
          <div className="space-y-4">
            {GOAL_PRESETS.map((preset) => (
              <div key={preset}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-[13px] font-semibold text-[var(--color-foreground)]">
                    {PRESET_LABEL[preset]}
                  </label>
                  <button
                    type="button"
                    onClick={() => resetPreset(preset)}
                    className="text-[11px] font-medium text-[var(--color-primary)] hover:underline"
                  >
                    Réinitialiser au défaut
                  </button>
                </div>
                <textarea
                  value={framings[preset]}
                  onChange={(e) => setPreset(preset, e.target.value)}
                  rows={preset === "sales" ? 4 : 3}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-foreground)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {error ? (
              <span className="font-semibold text-red-600">{error}</span>
            ) : dirty ? (
              "Modifications non enregistrées"
            ) : savedAt ? (
              `Enregistré à ${savedAt}`
            ) : (
              ""
            )}
          </span>
          <button
            type="submit"
            disabled={isPending || !dirty || !framings}
            className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </form>
  );
}
