"use client";

import { useState, useTransition } from "react";

import { PLANS, type PlanKey } from "@/lib/plans";

type DirectiveKey =
  | "spokenTime"
  | "spokenPhone"
  | "hangup"
  | "perCallCtx"
  | "configBlocks"
  | "greetingFallback"
  | "capabilities";
type PlanMap = Record<PlanKey, string>;
type Initial = Record<DirectiveKey, PlanMap>;

/**
 * Form pour éditer les 5 directives système (anciennement hardcodées dans
 * agent.ts du worker). Chaque directive est désormais PER-PLAN — l'admin
 * peut différencier le ton/règles entre Basique / Globale / Premium. Le
 * payload PUT renvoyé est `{spokenTimeDirectiveByPlan: {whatsapp, global,
 * premium}, ...}` pour chaque directive éditée.
 *
 * UI : 2 niveaux de tabs :
 *  - Plan selector au-dessus (Basique / Globale / Premium) qui change
 *    quelle map active on édite.
 *  - Tabs directives en-dessous (Heures / Numéros / Fin / Contexte / Config).
 */
export function SystemDirectivesForm({ initialByPlan }: { initialByPlan: Initial }) {
  // Plan actif (UI). Le state est PAR PLAN PAR DIRECTIVE — on garde une
  // map per-directive pour pouvoir tracker dirty/saved sans recharger.
  const [activePlan, setActivePlan] = useState<PlanKey>(PLANS[0].key);
  const [activeDirective, setActiveDirective] =
    useState<DirectiveKey>("spokenTime");

  // Edited state : map directive → map plan → string. Initialisé depuis props.
  const [edited, setEdited] = useState<Initial>(initialByPlan);
  // Baseline du "sauvegardé" — mise à jour après save successful pour que
  // le dot "dirty" se nettoie.
  const [saved, setSaved] = useState<Initial>(initialByPlan);

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const directives: Array<{
    key: DirectiveKey;
    label: string;
    description: string;
  }> = [
    {
      key: "spokenTime",
      label: "Heures",
      description:
        "Comment l'agent prononce les heures à voix haute (\"neuf heures\" vs \"zéro neuf zéro zéro\"). FR + HE.",
    },
    {
      key: "spokenPhone",
      label: "Numéros",
      description:
        "Comment l'agent prononce les numéros (chiffre par chiffre, format local sans +972).",
    },
    {
      key: "hangup",
      label: "Fin d'appel",
      description:
        "Règle pour appeler end_call après le goodbye. Évite que l'agent dise \"au revoir\" 2-3 fois.",
    },
    {
      key: "perCallCtx",
      label: "Contexte per-call",
      description:
        "Template injecté en chatCtx au début de chaque appel. Placeholders runtime : {date_fr}, {iso_date}, {time}, {caller_hint_block}.",
    },
    {
      key: "configBlocks",
      label: "Config blocs",
      description:
        "Directive meta qui prime le LLM à respecter strictement les étapes du persona (ne pas sauter en avant) et à produire une seule réponse par tour.",
    },
    {
      key: "greetingFallback",
      label: "Salutation fallback",
      description:
        "Texte injecté au moment du greeting QUAND le tenant n'a pas renseigné son greetingInstructions. Évite que le LLM hallucine un faux centre / faux prénom. Placeholder : {agent_name}.",
    },
    {
      key: "capabilities",
      label: "Capacités",
      description:
        "Bloc annonçant à l'agent quelles capacités sont activées selon les toggles des tuiles CRM du tenant. Placeholders remplacés au runtime par l'état réel : {calendar}, {crm}, {orders} → ACTIVÉE/DÉSACTIVÉE + consignes.",
    },
  ];

  const dirty = directives.some((d) =>
    PLANS.some((p) => edited[d.key][p.key] !== saved[d.key][p.key]),
  );
  const currentValue = edited[activeDirective][activePlan];
  const isCurrentDirty =
    currentValue !== saved[activeDirective][activePlan];
  const activeDirectiveMeta = directives.find(
    (d) => d.key === activeDirective,
  )!;

  // Diff dirty pour chaque (plan,directive) — utilisé pour le dot rouge.
  const planDirty = (plan: PlanKey) =>
    directives.some((d) => edited[d.key][plan] !== saved[d.key][plan]);
  const directiveDirtyForPlan = (key: DirectiveKey, plan: PlanKey) =>
    edited[key][plan] !== saved[key][plan];

  const updateValue = (
    key: DirectiveKey,
    plan: PlanKey,
    value: string,
  ): void => {
    setEdited((prev) => ({
      ...prev,
      [key]: { ...prev[key], [plan]: value },
    }));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Construit un payload qui n'envoie que les directives modifiées
      // pour limiter la charge réseau + traçabilité dans les logs admin.
      const payload: Record<string, Partial<PlanMap>> = {};
      const fieldMap: Record<DirectiveKey, string> = {
        spokenTime: "spokenTimeDirectiveByPlan",
        spokenPhone: "spokenPhoneDirectiveByPlan",
        hangup: "hangupDirectiveByPlan",
        perCallCtx: "perCallContextTemplateByPlan",
        configBlocks: "configBlocksDirectiveByPlan",
        greetingFallback: "greetingFallbackTemplateByPlan",
        capabilities: "capabilitiesDirectiveByPlan",
      };
      for (const d of directives) {
        const patch: Partial<PlanMap> = {};
        let touched = false;
        for (const p of PLANS) {
          if (edited[d.key][p.key] !== saved[d.key][p.key]) {
            patch[p.key] = edited[d.key][p.key];
            touched = true;
          }
        }
        if (touched) payload[fieldMap[d.key]] = patch;
      }
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      setSaved(edited);
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      id="directives"
      className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
            4 · Directives système éditables · par plan
          </p>
          <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">
            Comportements universels — indépendants par plan
          </h3>
        </div>
        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Live · prochain appel
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        Chaque plan a sa propre version de chaque directive — modifie le ton
        ou les règles indépendamment pour Basique, Globale et Premium. Vide
        un champ → fallback sur le défaut hardcoded de{" "}
        <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
          lib/agent-prompt-defaults.ts
        </code>
        . Un tenant peut désactiver tout cet héritage via la case{" "}
        <em>« Hériter du prompt global admin »</em> dans son dashboard.
      </p>

      {/* Plan selector */}
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

      {/* Directive tabs */}
      <div className="mb-3 inline-flex flex-wrap rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-1">
        {directives.map((d) => {
          const isActive = activeDirective === d.key;
          const isDirty = directiveDirtyForPlan(d.key, activePlan);
          return (
            <button
              type="button"
              key={d.key}
              onClick={() => setActiveDirective(d.key)}
              className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-white text-[var(--color-foreground)] shadow-sm ring-1 ring-[var(--color-border)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {d.label}
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
        <strong>{activeDirectiveMeta.label}</strong> · plan{" "}
        <strong>{PLANS.find((p) => p.key === activePlan)?.name}</strong> —{" "}
        {activeDirectiveMeta.description}
      </p>

      <textarea
        value={currentValue}
        onChange={(e) => updateValue(activeDirective, activePlan, e.target.value)}
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
              Modifications non sauvegardées{isCurrentDirty ? " (champ actif)" : ""}
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
