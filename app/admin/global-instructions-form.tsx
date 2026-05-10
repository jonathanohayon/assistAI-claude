"use client";

import { useState, useTransition } from "react";

const PLACEHOLDER_GLOBAL = `# Règles transverses appliquées à tous les tenants

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
  initialGlobal,
  initialTemplate,
}: {
  initialGlobal: string;
  initialTemplate: string;
}) {
  const [globalText, setGlobalText] = useState(initialGlobal);
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
          globalInstructions: globalText,
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
      {/* Global system rules */}
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
          Règles transverses
        </p>
        <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
          Préfixées au persona de chaque tenant à chaque appel. Toutes les
          tenants en bénéficient sans intervention de leur part.
        </p>
        <textarea
          value={globalText}
          onChange={(e) => {
            setGlobalText(e.target.value);
            setDirty(true);
          }}
          rows={14}
          placeholder={PLACEHOLDER_GLOBAL}
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
        />
      </div>

      {/* Onboarding template — seed for new tenants */}
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
          Template onboarding
        </p>
        <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
          Persona seed copiée dans la config de chaque nouveau tenant à son
          inscription. Modifications ultérieures à faire sur leur dashboard.
          Vide → utilise le persona Johana hard-codé en fallback.
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
