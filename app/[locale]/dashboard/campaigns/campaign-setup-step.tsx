"use client";

import { useTranslations } from "next-intl";

import { CALL_OUTCOMES, MAX_CONCURRENCY } from "@/lib/campaigns/constants";
import type { CampaignDraft } from "@/lib/campaigns/types";
import type { OutboundAgentListItem } from "@/lib/outbound-agents/types";
import type { EffectiveCapabilities } from "@/lib/tools/contract";

import { Chip, Field, Section, inputCls } from "./_ui";
import { CaptureFieldsEditor } from "./capture-fields-editor";
import { MissionCards } from "@/components/bricks/mission/MissionBrick";
import { useVoiceLabel } from "@/lib/use-voice-label";

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function CampaignSetupStep({
  draft,
  onChange,
  agents,
  fromNumbers,
  isAdmin = false,
  capabilities = null,
  captureOn = false,
}: {
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
  agents: OutboundAgentListItem[];
  fromNumbers: string[];
  /** M2d: admins also get the two admin-only mission cards. */
  isAdmin?: boolean;
  /** The picked agent's effective capabilities (GET /api/dashboard/tools?agentId=); null = unknown. */
  capabilities?: EffectiveCapabilities | null;
  /** The server's CAMPAIGN_CAPTURE switch as one boolean (off when absent). */
  captureOn?: boolean;
}) {
  const t = useTranslations("DashboardCampaigns");
  const voiceLabel = useVoiceLabel();
  const tDays = useTranslations("DashboardConfig");

  const selectedAgent = agents.find((a) => a.id === draft.agentId) ?? null;
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

          {/* M2b: the mission cards replace the goal-preset picker one for
           *  one; they write goalPreset only when a pick changes it. */}
          <MissionCards
            preset={draft.goalPreset}
            isAdmin={isAdmin}
            capabilities={capabilities}
            onPresetChange={(goalPreset) => onChange({ goalPreset: goalPreset as CampaignDraft["goalPreset"] })}
          />

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

      {/* Agent + n° appelant + critère de succès */}
      <Section
        title={t("agentSectionTitle")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <rect x="4" y="8" width="16" height="11" rx="3" />
            <path d="M12 8V4M9 13h.01M15 13h.01M2 12v3M22 12v3" />
          </svg>
        }
      >
        {agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-center">
            <p className="text-[13px] font-bold text-[#18181b]">
              {t("noAgentsTitle")}
            </p>
            <p className="mt-1 text-[12px] text-[#64748b]">
              {t("noAgentsBody")}
            </p>
          </div>
        ) : (
          <Field label={t("agentSelectLabel")} hint={t("agentSelectHint")}>
            <select
              className={inputCls}
              value={draft.agentId ?? ""}
              onChange={(e) => onChange({ agentId: e.target.value || null })}
            >
              <option value="">{t("agentSelectNone")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {voiceLabel(a.voice)} · {a.language.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
        )}

        {selectedAgent && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#f5f3ff] px-3 py-2 text-[12px] text-[#6d28d9]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="truncate">
              {t("agentSelectedHint", { name: selectedAgent.agentName })}
            </span>
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          <Field label={t("successCriteriaLabel")}>
            <input
              className={inputCls}
              value={draft.successCriteria}
              placeholder={t("successCriteriaPlaceholder")}
              onChange={(e) => onChange({ successCriteria: e.target.value })}
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

      {/* Fields to capture: hidden for tenants while capture is off. */}
      <CaptureFieldsEditor
        schema={draft.extractionSchema}
        onChange={(extractionSchema) => onChange({ extractionSchema })}
        captureOn={captureOn}
        isAdmin={isAdmin}
      />
    </div>
  );
}
