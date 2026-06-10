"use client";

/**
 * Tuile "Persona" : mode hérité admin vs custom (RadioCards + preview des
 * directives héritées), langue principale FR/HE/EN, nom de l'agent, phrase
 * d'accueil, encart tools disponibles et textarea instructions (persona).
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `persona`).
 */

import { RadioCard } from "./shared-ui";
import { ToolsAvailableHint } from "./tools-available-hint";
import type { FormState, FormUpdater, Translator } from "./types";

export function PersonaPanel({
  form,
  update,
  primaryLanguages,
  adminInheritablePreview,
  planLabel,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  primaryLanguages: ReadonlyArray<{ value: string; flag: string; label: string }>;
  adminInheritablePreview: string;
  planLabel: string;
  t: Translator;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Inherit mode */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/50 to-white/30 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {planLabel
            ? t("wowModeTitleWithPlan", { plan: planLabel })
            : t("wowModeTitle")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <RadioCard
            active={form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", true)}
            title={t("inheritAdminLabel")}
            desc={t("inheritAdminHelp")}
          />
          <RadioCard
            active={!form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", false)}
            title={t("wowModeCustom")}
            desc={t("wowModeCustomDesc")}
          />
        </div>
        {form.inheritAdminGlobals && adminInheritablePreview && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[10px] text-[#0e7490] hover:underline">
              {t("wowViewInherited")}
            </summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-[10px] leading-relaxed text-[#18181b]">
              {adminInheritablePreview}
            </pre>
          </details>
        )}
      </div>

      {/* Langue */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("primaryLanguageLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          {primaryLanguages.map((l) => {
            const active = l.value === form.primaryLanguage;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => update("primaryLanguage", l.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "border-transparent bg-[#18181b] text-white shadow-md"
                    : "border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:shadow-sm"
                }`}
              >
                <span className="font-mono text-[10px] opacity-70">{l.flag}</span>
                {l.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("primaryLanguageHint")}
        </p>
      </div>

      {/* Agent name (facultatif) — prononcé dans la phrase d'accueil */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("wowAgentNameLabel")}
          </p>
          <span className="text-[10px] text-[#94a3b8]">
            {t("wowOptional")}
          </span>
        </div>
        <input
          type="text"
          value={form.agentName}
          onChange={(e) => update("agentName", e.target.value)}
          placeholder={t("wowAgentNamePlaceholder")}
          maxLength={80}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("wowAgentNameHint")}
        </p>
      </div>

      {/* Greeting */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("greetingLabel")}
        </p>
        <input
          type="text"
          value={form.greetingInstructions}
          onChange={(e) => update("greetingInstructions", e.target.value)}
          placeholder={t("greetingPlaceholder")}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">{t("greetingHint")}</p>
      </div>

      {/* Tools disponibles — built-in + knowledge */}
      <ToolsAvailableHint form={form} update={update} />

      {/* Instructions (persona) — facultatif + contenu collapsable */}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("instructionsLabel")}
          </p>
          <span className="text-[10px] text-[#94a3b8]">{t("wowOptional")}</span>
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-[#475569]">
          {t("instructionsDescription")}
        </p>
        <details className="group rounded-2xl border border-[#e2e8f0] bg-white/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-[12px] font-medium text-[#0e7490] transition-colors hover:bg-[#ecfeff]/50">
            <span>{t("instructionsToggle")}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="px-3 pb-3">
            <textarea
              value={form.instructions}
              onChange={(e) => update("instructions", e.target.value)}
              rows={24}
              className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-3 font-mono text-xs leading-relaxed text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
            />
            <p className="mt-1.5 text-[11px] text-[#475569]">
              {t("instructionsHint")}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
