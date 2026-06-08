"use client";

import { useTranslations } from "next-intl";

import {
  CALL_OUTCOMES,
  EXTRACTION_FIELD_TYPES,
  GOAL_PRESETS,
  MAX_CONCURRENCY,
  type ExtractionField,
  type GoalPreset,
} from "@/lib/campaigns/constants";
import type { CampaignDraft } from "@/lib/campaigns/types";

import { Chip, Field, Section, inputCls } from "./_ui";

const GOAL_EMOJI: Record<GoalPreset, string> = {
  cold: "❄️",
  sales: "💼",
  lead_gen: "🎯",
  marketing: "📣",
  custom: "✨",
};

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function CampaignSetupStep({
  draft,
  onChange,
  voices,
  fromNumbers,
}: {
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
  voices: readonly string[];
  fromNumbers: string[];
}) {
  const t = useTranslations("DashboardCampaigns");
  const tDays = useTranslations("DashboardConfig");

  const setPersona = (patch: Partial<CampaignDraft["persona"]>) =>
    onChange({ persona: { ...draft.persona, ...patch } });
  const setRetry = (patch: Partial<CampaignDraft["retryRules"]>) =>
    onChange({ retryRules: { ...draft.retryRules, ...patch } });
  const setWindow = (patch: Partial<CampaignDraft["callWindow"]>) =>
    onChange({ callWindow: { ...draft.callWindow, ...patch } });

  const toggleRetryOn = (o: (typeof CALL_OUTCOMES)[number]) => {
    if (o === "connected") return;
    const has = draft.retryRules.retryOn.includes(o as never);
    setRetry({
      retryOn: (has
        ? draft.retryRules.retryOn.filter((x) => x !== o)
        : [...draft.retryRules.retryOn, o]) as CampaignDraft["retryRules"]["retryOn"],
    });
  };

  const toggleDay = (d: number) => {
    const has = draft.callWindow.days.includes(d);
    setWindow({
      days: has
        ? draft.callWindow.days.filter((x) => x !== d)
        : [...draft.callWindow.days, d].sort((a, b) => a - b),
    });
  };

  const addField = () =>
    onChange({
      extractionSchema: [
        ...draft.extractionSchema,
        { key: "", label: "", type: "string" },
      ],
    });
  const updateField = (i: number, patch: Partial<ExtractionField>) =>
    onChange({
      extractionSchema: draft.extractionSchema.map((f, idx) =>
        idx === i ? { ...f, ...patch } : f,
      ),
    });
  const removeField = (i: number) =>
    onChange({
      extractionSchema: draft.extractionSchema.filter((_, idx) => idx !== i),
    });

  return (
    <div className="space-y-4">
      {/* Identité campagne */}
      <Section
        title={t("setupTitle")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M3 11l18-5v12L3 14v-3z" />
          </svg>
        }
      >
        <div className="space-y-3">
          <Field label={t("nameLabel")}>
            <input
              className={inputCls}
              value={draft.name}
              placeholder={t("namePlaceholder")}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-[12px] font-semibold text-[#334155]">
              {t("goalLabel")}
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {GOAL_PRESETS.map((g) => {
                const active = draft.goalPreset === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onChange({ goalPreset: g })}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-2.5 text-center transition ${
                      active
                        ? "border-[#f97316] bg-[#fff7ed] shadow-sm"
                        : "border-[#e2e8f0] bg-white hover:border-[#f97316]/40"
                    }`}
                  >
                    <span className="text-lg">{GOAL_EMOJI[g]}</span>
                    <span className="text-[11px] font-semibold text-[#334155]">
                      {t(`goal_${g}`)}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-[#94a3b8]">
              {t(`goalDesc_${draft.goalPreset}`)}
            </p>
          </div>

          <Field label={t("objectiveLabel")}>
            <textarea
              className={`${inputCls} min-h-[90px] resize-y`}
              value={draft.objective}
              placeholder={t("objectivePlaceholder")}
              onChange={(e) => onChange({ objective: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      {/* Agent / voix */}
      <Section
        title={t("voiceLabel")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("agentNameLabel")}>
            <input
              className={inputCls}
              value={draft.persona.agentName ?? ""}
              placeholder={t("agentNamePlaceholder")}
              onChange={(e) => setPersona({ agentName: e.target.value })}
            />
          </Field>
          <Field label={t("voiceLabel")}>
            <select
              className={inputCls}
              value={draft.persona.voice ?? ""}
              onChange={(e) => setPersona({ voice: e.target.value })}
            >
              <option value="">—</option>
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("languageLabel")}>
            <select
              className={inputCls}
              value={draft.persona.language ?? ""}
              onChange={(e) => setPersona({ language: e.target.value })}
            >
              <option value="">—</option>
              <option value="fr">Français</option>
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t("fromNumberLabel")}>
            <select
              className={inputCls}
              value={draft.fromNumber}
              onChange={(e) => onChange({ fromNumber: e.target.value })}
            >
              <option value="">{t("fromNumberNone")}</option>
              {fromNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3">
          <Field label={t("successCriteriaLabel")}>
            <input
              className={inputCls}
              value={draft.persona.successCriteria ?? ""}
              placeholder={t("successCriteriaPlaceholder")}
              onChange={(e) => setPersona({ successCriteria: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      {/* Concurrence + retry */}
      <Section
        title={t("concurrencyLabel")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={MAX_CONCURRENCY}
            value={draft.concurrency}
            onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gradient-to-r from-[#f97316] to-[#db2777]"
          />
          <span className="w-10 text-center text-[15px] font-extrabold text-[#db2777]">
            {draft.concurrency}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#94a3b8]">{t("concurrencyHint")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("retryMaxAttempts")}>
            <input
              type="number"
              min={1}
              max={5}
              className={inputCls}
              value={draft.retryRules.maxAttempts}
              onChange={(e) =>
                setRetry({ maxAttempts: Number(e.target.value) })
              }
            />
          </Field>
          <Field label={t("retryBackoff")}>
            <input
              type="number"
              min={1}
              max={1440}
              className={inputCls}
              value={draft.retryRules.backoffMinutes}
              onChange={(e) =>
                setRetry({ backoffMinutes: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <div className="mt-3">
          <span className="mb-1.5 block text-[12px] font-semibold text-[#334155]">
            {t("retryOnLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {CALL_OUTCOMES.filter((o) => o !== "connected").map((o) => (
              <Chip
                key={o}
                active={draft.retryRules.retryOn.includes(o as never)}
                onClick={() => toggleRetryOn(o)}
              >
                {t(`retry_${o}`)}
              </Chip>
            ))}
          </div>
        </div>
      </Section>

      {/* Fenêtre d'appel + DNC */}
      <Section
        title={t("windowTitle")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("windowTimezone")}>
            <input
              className={inputCls}
              value={draft.callWindow.timezone}
              onChange={(e) => setWindow({ timezone: e.target.value })}
            />
          </Field>
          <Field label={t("windowStart")}>
            <input
              type="number"
              min={0}
              max={23}
              className={inputCls}
              value={draft.callWindow.startHour}
              onChange={(e) => setWindow({ startHour: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("windowEnd")}>
            <input
              type="number"
              min={0}
              max={23}
              className={inputCls}
              value={draft.callWindow.endHour}
              onChange={(e) => setWindow({ endHour: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="mt-3">
          <span className="mb-1.5 block text-[12px] font-semibold text-[#334155]">
            {t("windowDays")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => (
              <Chip
                key={d}
                active={draft.callWindow.days.includes(d)}
                onClick={() => toggleDay(d)}
              >
                {tDays(`businessDay${DAY_KEYS[d]}Short`)}
              </Chip>
            ))}
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5">
          <input
            type="checkbox"
            checked={draft.callWindow.respectDnc}
            onChange={(e) => setWindow({ respectDnc: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[#f97316]"
          />
          <span>
            <span className="block text-[12px] font-semibold text-[#334155]">
              {t("dncLabel")}
            </span>
            <span className="block text-[11px] text-[#94a3b8]">{t("dncHint")}</span>
          </span>
        </label>
      </Section>

      {/* Schéma d'extraction */}
      <Section
        title={t("extractionTitle")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h4" />
          </svg>
        }
      >
        <p className="mb-2 text-[11px] text-[#94a3b8]">{t("extractionHint")}</p>
        <div className="space-y-2">
          {draft.extractionSchema.map((f, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white p-2"
            >
              <input
                className={`${inputCls} min-w-[110px] flex-1`}
                placeholder={t("extractionKey")}
                value={f.key}
                onChange={(e) => updateField(i, { key: e.target.value })}
              />
              <input
                className={`${inputCls} min-w-[110px] flex-1`}
                placeholder={t("extractionLabelField")}
                value={f.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
              />
              <select
                className={`${inputCls} w-auto`}
                value={f.type}
                onChange={(e) =>
                  updateField(i, {
                    type: e.target.value as ExtractionField["type"],
                  })
                }
              >
                {EXTRACTION_FIELD_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`type_${ty}`)}
                  </option>
                ))}
              </select>
              {f.type === "enum" && (
                <input
                  className={`${inputCls} basis-full`}
                  placeholder={t("extractionOptions")}
                  value={(f.options ?? []).join(", ")}
                  onChange={(e) =>
                    updateField(i, {
                      options: e.target.value
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
              <button
                type="button"
                onClick={() => removeField(i)}
                aria-label={t("extractionRemove")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition hover:bg-[#fee2e2] hover:text-[#dc2626]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addField}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#f97316]/50 px-3 py-1.5 text-[12px] font-semibold text-[#ea580c] transition hover:bg-[#fff7ed]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("extractionAddField")}
        </button>
      </Section>
    </div>
  );
}
