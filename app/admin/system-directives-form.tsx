"use client";

import { useState, useTransition } from "react";

/**
 * Form pour éditer les 4 directives système qui étaient historiquement
 * hardcodées dans agent.ts du worker. Maintenant elles vivent en DB
 * (app_settings) et sont injectées au début du system prompt par
 * /api/agent/config. Vide pour une directive → fallback constant
 * lib/agent-prompt-defaults.ts.
 *
 * Singleton (pas per-plan) — comportements universels.
 */
export function SystemDirectivesForm({
  initial,
}: {
  initial: {
    spokenTimeDirective: string;
    spokenPhoneDirective: string;
    hangupDirective: string;
    perCallContextTemplate: string;
    configBlocksDirective: string;
  };
}) {
  const [spokenTime, setSpokenTime] = useState(initial.spokenTimeDirective);
  const [spokenPhone, setSpokenPhone] = useState(initial.spokenPhoneDirective);
  const [hangup, setHangup] = useState(initial.hangupDirective);
  const [perCallCtx, setPerCallCtx] = useState(initial.perCallContextTemplate);
  const [configBlocks, setConfigBlocks] = useState(initial.configBlocksDirective);
  const [active, setActive] = useState<
    "spokenTime" | "spokenPhone" | "hangup" | "perCallCtx" | "configBlocks"
  >("spokenTime");
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
          spokenTimeDirective: spokenTime,
          spokenPhoneDirective: spokenPhone,
          hangupDirective: hangup,
          perCallContextTemplate: perCallCtx,
          configBlocksDirective: configBlocks,
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

  const tabs: Array<{
    key: typeof active;
    label: string;
    description: string;
    value: string;
    setter: (v: string) => void;
    initialValue: string;
  }> = [
    {
      key: "spokenTime",
      label: "Heures",
      description:
        "Comment l'agent prononce les heures à voix haute (\"neuf heures\" vs \"zéro neuf zéro zéro\"). FR + HE.",
      value: spokenTime,
      setter: setSpokenTime,
      initialValue: initial.spokenTimeDirective,
    },
    {
      key: "spokenPhone",
      label: "Numéros",
      description:
        "Comment l'agent prononce les numéros (chiffre par chiffre, format local sans +972).",
      value: spokenPhone,
      setter: setSpokenPhone,
      initialValue: initial.spokenPhoneDirective,
    },
    {
      key: "hangup",
      label: "Fin d'appel",
      description:
        "Règle pour appeler end_call après le goodbye. Évite que l'agent dise \"au revoir\" 2-3 fois.",
      value: hangup,
      setter: setHangup,
      initialValue: initial.hangupDirective,
    },
    {
      key: "perCallCtx",
      label: "Contexte per-call",
      description:
        "Template injecté en chatCtx au début de chaque appel. Placeholders runtime : {date_fr}, {iso_date}, {time}, {caller_hint_block}.",
      value: perCallCtx,
      setter: setPerCallCtx,
      initialValue: initial.perCallContextTemplate,
    },
    {
      key: "configBlocks",
      label: "Config blocs",
      description:
        "Directive meta qui prime le LLM à respecter strictement les étapes du persona (ne pas sauter en avant). Injecté comme un bloc système — son ordre dans le prompt est paramétrable via 'Ordre des blocs'.",
      value: configBlocks,
      setter: setConfigBlocks,
      initialValue: initial.configBlocksDirective,
    },
  ];

  const activeTab = tabs.find((t) => t.key === active)!;

  return (
    <form
      onSubmit={onSubmit}
      id="directives"
      className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
            4 · Directives système éditables
          </p>
          <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
            Comportements universels · singleton
          </h3>
        </div>
        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Live · prochain appel
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        Anciennement hardcodés dans <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">agent.ts</code>{" "}
        du worker, ces 4 textes sont maintenant pilotables d&apos;ici. Ils
        s&apos;injectent <strong>au début du system prompt</strong> avant la
        persona tenant — donc ils s&apos;appliquent à tous les tenants tous
        plans. Laisse vide pour utiliser la valeur par défaut de{" "}
        <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
          lib/agent-prompt-defaults.ts
        </code>
        .
      </p>

      <div className="mb-3 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-1">
        {tabs.map((t) => {
          const isActive = active === t.key;
          const isDirty = t.value !== t.initialValue;
          return (
            <button
              type="button"
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-white text-[var(--color-foreground)] shadow-sm ring-1 ring-[var(--color-border)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {t.label}
              {isDirty && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="mb-2 text-xs italic text-[var(--color-muted-foreground)]">
        {activeTab.description}
      </p>

      <textarea
        value={activeTab.value}
        onChange={(e) => {
          activeTab.setter(e.target.value);
          setDirty(true);
        }}
        rows={18}
        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
      />

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
        <button
          type="submit"
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Sauvegarde…" : "Sauvegarder les directives"}
        </button>
      </div>
    </form>
  );
}
