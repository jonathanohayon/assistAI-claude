"use client";

/**
 * Voice brick — ADMIN-ONLY level-3 parts, loaded with next/dynamic from
 * VoiceBrick for admins only; copy in the admin namespaces (AdminEngine,
 * AdminVoiceProfile), so supplier names never reach a tenant's browser.
 *   VoiceAdminFields  — engine + model, then the engine-dependent settings
 *                       (shown FIRST in "Developer settings": most consequential);
 *   VoiceSamplesAdmin — the voice samples + "Generate" (shown LAST: maintenance).
 */

import { useEffect, useId, useState, useSyncExternalStore } from "react";
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
import { useRealtimeCatalog } from "@/lib/use-realtime-catalog";

import type { ClientVoice } from "./voice-client";

import { ADMIN_ENGINE_OPTIONS, engineOptionOf, engineOptionPatch } from "./voice-admin";
import { generateAllSamples, type GenerateProgress, type GenerateResponse } from "./generate-samples";
import { getSamples, loadSamples, subscribeSamples } from "./voice-samples-store";
import { samplePlan } from "@/lib/voice/samples";
import { useVoiceLabel } from "@/lib/use-voice-label";

const OPTION_KEY: Record<string, string> = {
  "openai-2": "optionOpenai2",
  "openai-2.1": "optionOpenai21",
  gemini: "optionGemini",
  xai: "optionXai",
};

const SELECT =
  "min-h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";

export function VoiceAdminFields({
  value: served,
  onPatch,
  primaryLanguage,
}: {
  /** Admins are served the full voice (voiceForViewer). */
  value: ClientVoice;
  onPatch: (patch: Record<string, unknown>) => void;
  primaryLanguage: string | null;
}) {
  const value = served as Voice;
  // The live model catalog names suppliers: fetched here, admin-only code.
  const catalogModels = useRealtimeCatalog().models;
  const tE = useTranslations("AdminEngine");
  const tP = useTranslations("AdminVoiceProfile");
  const a = value.advanced;
  const option = engineOptionOf(value);
  const adv = (patch: Partial<Voice["advanced"]>) => onPatch({ advanced: patch });
  const onOpenai = value.engine === "auto" || value.engine === "openai";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-[#18181b]">{tP("title")}</h4>
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
      {/* V8e: an engine change moves the account's voice to its closest equivalent. */}
      <p className="-mt-2 text-xs text-[#475569]">{tE("changesVoice")}</p>
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

type SampleEngine = "openai" | "gemini" | "xai";
const SAMPLE_ENGINES: readonly SampleEngine[] = ["openai", "gemini", "xai"];
/**
 * Samples per engine. OpenAI: every voice × style × language (72). Gemini and
 * Grok (V8c): the six recommended voices, "warm" only, Grok without Hebrew —
 * mirror of lib/voice/engine-samples.ts (server-only), pinned by a test.
 */
export const SAMPLE_TOTALS: Record<SampleEngine, number> = { openai: samplePlan().length, gemini: 18, xai: 12 };
/** Which engine a listed sample belongs to: our ids 2xx = Gemini, 3xx = Grok; OpenAI keys are voice names. */
export const sampleEngineOf = (voiceId: string): SampleEngine =>
  voiceId.startsWith("voice-2") ? "gemini" : voiceId.startsWith("voice-3") ? "xai" : "openai";
const engineOf = (e: string | undefined): SampleEngine => (e === "gemini" || e === "xai" ? e : "openai");

/** GET /api/voice/samples, admin response: per engine, whether its key is set and which variable to set (never a value). */
type EngineKeys = Partial<Record<SampleEngine, { keySet: boolean; env: string; total?: number }>>;

/**
 * Admin: the voice samples block, last in "Developer settings" (maintenance,
 * not a setting). One row per engine, the account's engine first.
 */
export function VoiceSamplesAdmin({ engine }: { engine?: string }) {
  const first = engineOf(engine);
  const order = [first, ...SAMPLE_ENGINES.filter((e) => e !== first)];
  const [keys, setKeys] = useState<EngineKeys>({});
  // Only one engine renders at a time (each pass calls a paid TTS API).
  const [busy, setBusy] = useState<SampleEngine | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/voice/samples", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { admin?: { engines?: EngineKeys } } | null) => {
        if (live && b?.admin?.engines) setKeys(b.admin.engines);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AdminBadge size="xs" />
      </div>
      {order.map((e) => (
        <GenerateSamples key={e} engine={e} keyInfo={keys[e]} busy={busy} setBusy={setBusy} />
      ))}
    </div>
  );
}

/** Admin: render every missing Listen sample of ONE engine, with its own count; safe to re-click. */
function GenerateSamples({
  engine,
  keyInfo,
  busy,
  setBusy,
}: {
  engine: SampleEngine;
  /** Absent: the server didn't say (older server) — the button stays usable. */
  keyInfo?: { keySet: boolean; env: string; total?: number };
  busy: SampleEngine | null;
  setBusy: (e: SampleEngine | null) => void;
}) {
  const tP = useTranslations("AdminVoiceProfile");
  const voiceLabel = useVoiceLabel();
  const samples = useSyncExternalStore(subscribeSamples, getSamples, getSamples);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  // The generate route's own "missing_key" answer (the key went missing after the page loaded).
  const [refusedEnv, setRefusedEnv] = useState<string | null>(null);
  const running = busy === engine;
  const total = keyInfo?.total ?? SAMPLE_TOTALS[engine];
  const keysOf = (keys: Iterable<string>) => new Set([...keys].filter((k) => sampleEngineOf(k.split("/")[0]) === engine));
  const existing = progress?.done ?? keysOf(samples.byKey.keys()).size;
  const missingKey = keyInfo && !keyInfo.keySet ? keyInfo.env : refusedEnv;

  const run = async () => {
    if (busy || missingKey) return;
    setBusy(engine);
    try {
      await generateAllSamples({
        total,
        existing: async () => {
          await loadSamples(fetch, true);
          return keysOf(getSamples().byKey.keys());
        },
        post: async () => {
          // OpenAI is the endpoint's default (no engine parameter).
          const qs = engine === "openai" ? "" : `&engine=${engine}`;
          const res = await fetch(`/api/admin/voice-samples/generate?limit=6${qs}`, { method: "POST" });
          const json = (await res.json().catch(() => null)) as (GenerateResponse & { error?: string; env?: string }) | null;
          if (res.status === 400 && json?.error === "missing_key" && json.env) setRefusedEnv(json.env);
          return { ok: res.ok, status: res.status, body: res.ok ? json : null };
        },
        onProgress: setProgress,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#18181b]">
            {tP("samplesTitle")} · {tP(`engine.${engine}`)}
          </p>
          <p className="mt-0.5 text-xs text-[#475569]" aria-live="polite">
            {tP("samplesCount", { done: existing, total })}
            {progress?.status === "done" && ` · ${tP("samplesDone")}`}
            {progress?.status === "stuck" && ` · ${tP("samplesStuck")}`}
            {progress?.status === "error" && ` · ${tP("samplesError", { error: progress.error ?? "" })}`}
          </p>
          {missingKey && (
            <p role="note" className="mt-1 text-xs font-semibold text-[#92400e]">
              {tP.rich("samplesMissingKey", { env: missingKey, k: (c) => <code dir="ltr" className="font-mono">{c}</code> })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!!busy || !!missingKey || (existing >= total && !progress)}
          aria-busy={running}
          className="min-h-11 cursor-pointer rounded-xl bg-gradient-to-br from-[#be185d] to-[#db2777] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          {running ? tP("samplesRunning") : tP("samplesGenerate")}
        </button>
      </div>
      {progress && progress.failed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-[#b91c1c]" role="status">
          {progress.failed.map((f) => (
            <li key={`${f.voiceId}/${f.style}/${f.language}`}>
              {engine === "openai" ? voiceLabel(f.voiceId) : f.voiceId} · {f.style} · {f.language.toUpperCase()} — {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
