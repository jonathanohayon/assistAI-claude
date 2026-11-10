"use client";

/**
 * Voice brick — ADMIN-ONLY level-3 fields: engine and model, per-engine voice
 * overrides, turn detection, reasoning, language hint, fillers, speaking
 * style. Loaded with next/dynamic from VoiceBrick for admins only, and its
 * copy lives in the admin namespaces (AdminEngine, AdminVoiceProfile), so
 * supplier names never reach a tenant's browser.
 */

import { useId } from "react";
import { useTranslations } from "next-intl";

import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";
import {
  GROK_REASONING,
  LANGUAGE_HINTS,
  OPENAI_EAGERNESS,
  OPENAI_NOISE,
  OPENAI_REASONING,
  OPENAI_TURN_MODES,
} from "@/lib/voice-profile";
import type { Voice } from "@/lib/voice/contract";

import { ADMIN_ENGINE_OPTIONS, engineOptionOf, engineOptionPatch } from "./voice-admin";

const OPTION_KEY: Record<string, string> = {
  "openai-2": "optionOpenai2",
  "openai-2.1": "optionOpenai21",
  gemini: "optionGemini",
  xai: "optionXai",
};

const SELECT =
  "min-h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";

export function VoiceAdminFields({
  value,
  onPatch,
  catalogModels,
  primaryLanguage,
}: {
  value: Voice;
  onPatch: (patch: Record<string, unknown>) => void;
  catalogModels: ReadonlyArray<{ id: string; provider: string }>;
  primaryLanguage: string | null;
}) {
  const tE = useTranslations("AdminEngine");
  const tP = useTranslations("AdminVoiceProfile");
  const a = value.advanced;
  const option = engineOptionOf(value);
  const adv = (patch: Partial<Voice["advanced"]>) => onPatch({ advanced: patch });
  const onOpenai = value.engine === "auto" || value.engine === "openai";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-[#18181b]">{tE("label")}</h4>
        <AdminBadge size="xs" />
      </div>

      <Select
        label={tE("label")}
        value={option}
        onChange={(id) => {
          if (id !== "custom") onPatch(engineOptionPatch(id as (typeof ADMIN_ENGINE_OPTIONS)[number]["id"]));
        }}
        options={[
          ...ADMIN_ENGINE_OPTIONS.map((o) => ({ id: o.id, label: tE.has(OPTION_KEY[o.id]) ? tE(OPTION_KEY[o.id]) : o.label })),
          ...(option === "custom" ? [{ id: "custom", label: tE("optionCustom", { model: a.model ?? "" }) }] : []),
        ]}
      />
      {value.engine === "xai" && primaryLanguage === "he" && (
        <p role="note" className="text-xs font-semibold text-[#b45309]">
          {tE("xaiHebrewWarning")}
        </p>
      )}

      {onOpenai && catalogModels.length > 0 && (
        <Select
          label={tE("advancedModel")}
          value={a.model ?? ""}
          onChange={(model) => adv({ model: model || null })}
          options={[
            { id: "", label: tP("none") },
            ...catalogModels.filter((m) => m.provider === "openai").map((m) => ({ id: m.id, label: m.id })),
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["openai", "gemini", "xai"] as const).map((eng) => (
          <TextField
            key={eng}
            label={`${tP("fields.voiceOverrides.label")} · ${tP(`engine.${eng}`)}`}
            value={a.voiceOverrides[eng] ?? ""}
            maxLength={40}
            onChange={(v) => {
              const next = { ...a.voiceOverrides };
              if (v.trim()) next[eng] = v.trim();
              else delete next[eng];
              adv({ voiceOverrides: next });
            }}
          />
        ))}
      </div>

      {onOpenai && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EnumSelect field="openaiTurnMode" options={OPENAI_TURN_MODES} value={a.openaiTurnMode} onChange={(v) => adv({ openaiTurnMode: v as Voice["advanced"]["openaiTurnMode"] })} />
          {a.openaiTurnMode === "semantic_vad" && (
            <EnumSelect field="openaiEagerness" options={OPENAI_EAGERNESS} value={a.openaiEagerness} onChange={(v) => adv({ openaiEagerness: v as Voice["advanced"]["openaiEagerness"] })} />
          )}
          <EnumSelect field="openaiNoiseReduction" options={OPENAI_NOISE} value={a.openaiNoiseReduction} onChange={(v) => adv({ openaiNoiseReduction: v as Voice["advanced"]["openaiNoiseReduction"] })} />
          <EnumSelect field="openaiReasoning" options={OPENAI_REASONING} value={a.openaiReasoning} onChange={(v) => adv({ openaiReasoning: v as Voice["advanced"]["openaiReasoning"] })} />
        </div>
      )}
      {value.engine === "xai" && (
        <EnumSelect field="grokReasoning" options={GROK_REASONING} value={a.grokReasoning} onChange={(v) => adv({ grokReasoning: v as Voice["advanced"]["grokReasoning"] })} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EnumSelect field="languageHint" options={LANGUAGE_HINTS} value={a.languageHint} onChange={(v) => adv({ languageHint: v as Voice["advanced"]["languageHint"] })} />
        <Select
          label={tP("fields.fillers.label")}
          value={a.fillers ? "on" : "off"}
          onChange={(v) => adv({ fillers: v === "on" })}
          options={[
            { id: "on", label: tP("on") },
            { id: "off", label: tP("off") },
          ]}
        />
      </div>

      <TextField
        label={tP("fields.speakingStyle.label")}
        value={a.speakingStyle}
        maxLength={300}
        multiline
        onChange={(speakingStyle) => adv({ speakingStyle })}
      />
    </div>
  );

  function EnumSelect({
    field,
    options,
    value: v,
    onChange,
  }: {
    field: string;
    options: readonly string[];
    value: string;
    onChange: (v: string) => void;
  }) {
    return (
      <Select
        label={tP(`fields.${field}.label`)}
        value={v}
        onChange={onChange}
        options={options.map((o) => ({ id: o, label: tP.has(`options.${field}.${o}`) ? tP(`options.${field}.${o}`) : o }))}
      />
    );
  }
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-[#18181b]">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${SELECT}`}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  const id = useId();
  const cls =
    "mt-1 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-[#18181b]">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} value={value} maxLength={maxLength} rows={3} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input id={id} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className={`${cls} min-h-11`} />
      )}
    </div>
  );
}
