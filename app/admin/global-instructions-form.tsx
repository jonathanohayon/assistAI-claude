"use client";

import { useState, useTransition } from "react";

import { PLANS, type PlanKey } from "@/lib/plans";

const PLACEHOLDER_GLOBAL = `# Règles transverses appliquées à chaque appel pour ce plan

Ton :
- Empathique et chaleureuse
- Réponses courtes (1-2 phrases max)

Anti-silence :
Avant d'appeler un tool, dire à voix haute "Je consulte tout ça, deux secondes...".

…etc.`;

const PLACEHOLDER_TEMPLATE = `# Persona par défaut pour tout nouveau tenant

Tu es **<Nom>**, secrétaire chaleureuse du centre **<Nom du centre>**.
…

Le tenant pourra personnaliser depuis son dashboard. Laisse vide pour
utiliser le persona Johana de fallback.`;

export function GlobalInstructionsForm({
  initialGlobalByPlan,
  initialTemplate,
}: {
  initialGlobalByPlan: Record<PlanKey, string>;
  initialTemplate: string;
}) {
  const [globalByPlan, setGlobalByPlan] =
    useState<Record<PlanKey, string>>(initialGlobalByPlan);
  const [activePlan, setActivePlan] = useState<PlanKey>(PLANS[0].key);
  const [templateText, setTemplateText] = useState(initialTemplate);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalInstructionsByPlan: globalByPlan,
          onboardingTemplate: templateText,
        }),
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
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Global system rules — applied at runtime to every tenant, per plan */}
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
              1 · Règles communes appliquées à chaque appel
            </p>
            <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
              Préfixe du système · par plan
            </h3>
          </div>
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Live · prochain appel
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Ce texte est <strong>collé devant la persona du tenant</strong> au
          début de chaque appel, selon son plan. Idéal pour : ton général,
          anti-silence, format de réponse, règles légales spécifiques à un
          niveau d&apos;abonnement. Sauvegarde → s&apos;applique immédiatement.
        </p>

        {/* Plan tabs */}
        <div className="mb-3 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-1">
          {PLANS.map((p) => {
            const active = activePlan === p.key;
            const planDirty =
              globalByPlan[p.key] !== initialGlobalByPlan[p.key];
            return (
              <button
                type="button"
                key={p.key}
                onClick={() => setActivePlan(p.key)}
                className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-[var(--color-foreground)] shadow-sm ring-1 ring-[var(--color-border)]"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {p.name}
                {planDirty && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
                  />
                )}
              </button>
            );
          })}
        </div>

        <textarea
          value={globalByPlan[activePlan] ?? ""}
          onChange={(e) => {
            setGlobalByPlan((prev) => ({
              ...prev,
              [activePlan]: e.target.value,
            }));
            setDirty(true);
          }}
          rows={14}
          placeholder={PLACEHOLDER_GLOBAL}
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
        />
      </div>

      {/* Onboarding template — seed for new tenants */}
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
              2 · Persona par défaut des nouveaux tenants
            </p>
            <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
              Template d&apos;inscription
            </h3>
          </div>
          <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            Seed · nouveaux comptes uniquement
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Copié dans la config d&apos;un tenant <strong>au moment de son
          inscription</strong>, puis personnalisable depuis son dashboard. Les
          modifs ici n&apos;affectent <strong>pas</strong> les tenants déjà
          existants. Laisse vide pour utiliser le persona Johana hard-codé.
        </p>
        <textarea
          value={templateText}
          onChange={(e) => {
            setTemplateText(e.target.value);
            setDirty(true);
          }}
          rows={14}
          placeholder={PLACEHOLDER_TEMPLATE}
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
        />
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
