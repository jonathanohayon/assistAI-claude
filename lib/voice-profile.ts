// Voice profile: how the phone agent listens, interrupts and speaks, per
// tenant. ADMIN-ONLY (same rule as the engine picker): stored in
// agent_configs.voice_profile (JSONB, NULL = all defaults), never shown to or
// writable by tenants. Every default is TODAY's exact worker behaviour, so a
// saved but untouched profile changes nothing.
//
// The worker maps it to each engine's options (mapVoiceProfile, worker repo).
// VOICE_PROFILE_FIELDS drives the admin card; its `doc` is the English source
// for the UI tooltips (FR/EN/HE copy lives in the FE).
// Unit-tested in scripts/tests/voice-profile.test.ts.

import { z } from "zod";

import type { RealtimeProvider } from "@/lib/realtime-provider";

const ALL: RealtimeProvider[] = ["openai", "gemini", "xai"];

// 5 notches since V9a (lib/voice/public.ts). The worker live today reads
// only slow / normal / fast: the two ends are folded into fields it already
// reads when served (lib/voice/engine.ts), never sent as is.
export { VOICE_PACES as PACES } from "@/lib/voice/public";
import { VOICE_PACES as PACES } from "@/lib/voice/public";
export const LANGUAGE_HINTS = ["auto", "fr", "he", "en"] as const;
export const OPENAI_TURN_MODES = ["server_vad", "semantic_vad"] as const;
export const OPENAI_EAGERNESS = ["auto", "low", "medium", "high"] as const;
export const OPENAI_NOISE = ["off", "near_field", "far_field"] as const;
export const OPENAI_REASONING = ["default", "none", "low", "medium", "high"] as const;
export const GROK_REASONING = ["high", "none"] as const;

const LIMITS = {
  terms: { maxItems: 50, maxLength: 40 },
  pronunciations: { maxItems: 50, maxTerm: 40, maxSayAs: 80 },
  speakingStyle: 300,
  voiceName: 40,
} as const;

export const voiceProfileSchema = z
  .object({
    // (a) every engine
    turnSensitivity: z.number().int().min(1).max(5),
    bargeIn: z.boolean(),
    keyTerms: z.array(z.string().trim().min(1).max(LIMITS.terms.maxLength)).max(LIMITS.terms.maxItems),
    languageHint: z.enum(LANGUAGE_HINTS),
    voiceOverrides: z
      .object({
        openai: z.string().trim().max(LIMITS.voiceName).optional(),
        gemini: z.string().trim().max(LIMITS.voiceName).optional(),
        xai: z.string().trim().max(LIMITS.voiceName).optional(),
      })
      .strict(),
    // (b) our layer
    minInterruptionMs: z.number().int().min(0).max(2000),
    idleHangupSec: z.number().int().min(10).max(120),
    maxDurationMin: z.number().int().min(1).max(60),
    pace: z.enum(PACES),
    pronunciations: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(LIMITS.pronunciations.maxTerm),
            sayAs: z.string().trim().min(1).max(LIMITS.pronunciations.maxSayAs),
          })
          .strict(),
      )
      .max(LIMITS.pronunciations.maxItems),
    fillers: z.boolean(),
    speakingStyle: z.string().max(LIMITS.speakingStyle),
    languageLock: z.boolean(),
    // (c) engine-specific
    openaiTurnMode: z.enum(OPENAI_TURN_MODES),
    openaiEagerness: z.enum(OPENAI_EAGERNESS),
    openaiNoiseReduction: z.enum(OPENAI_NOISE),
    openaiReasoning: z.enum(OPENAI_REASONING),
    grokReasoning: z.enum(GROK_REASONING),
  })
  .strict();

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

/** Today's exact behaviour (worker on 2026-11-03). */
export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  turnSensitivity: 3, // = server_vad threshold 0.75, prefix 150 ms, silence 350 ms
  bargeIn: true,
  keyTerms: [],
  languageHint: "auto", // = the tenant's primaryLanguage, caller can switch
  voiceOverrides: {}, // = automatic per-engine mapping of the tenant voice
  minInterruptionMs: 500, // LiveKit agents default
  idleHangupSec: 30, // SILENCE_HANGUP_MS
  maxDurationMin: 30, // MAX_CALL_DURATION_MS
  pace: "normal", // = the tenant's speed setting as is
  pronunciations: [],
  fillers: true, // prompt unchanged
  speakingStyle: "",
  languageLock: false,
  openaiTurnMode: "server_vad",
  openaiEagerness: "auto",
  openaiNoiseReduction: "off", // ai-coustics cleans the audio before the model
  openaiReasoning: "default", // = by model: none on gpt-realtime-2, low on 2.1
  grokReasoning: "high", // xAI default
};

type Kind = "slider" | "toggle" | "select" | "number" | "list" | "text";

export interface VoiceProfileField {
  key: keyof VoiceProfile;
  section: "all" | "ours" | "engine";
  engines: RealtimeProvider[];
  kind: Kind;
  min?: number;
  max?: number;
  step?: number;
  unit?: "ms" | "s" | "min" | "x";
  options?: readonly string[];
  list?: "terms" | "pronunciations";
  maxItems?: number;
  maxLength?: number;
  maxTerm?: number;
  maxSayAs?: number;
  visibleWhen?: { key: keyof VoiceProfile; equals: unknown };
  default: unknown;
  /** English source for the tooltip: what it does + the real limits. */
  doc: string;
}

const D = DEFAULT_VOICE_PROFILE;

export const VOICE_PROFILE_FIELDS: ReadonlyArray<VoiceProfileField> = [
  {
    key: "turnSensitivity", section: "all", engines: ALL, kind: "slider", min: 1, max: 5, step: 1,
    default: D.turnSensitivity,
    doc: "How quickly the agent decides the caller has finished speaking. Higher = answers sooner after a pause but may cut callers off; lower = waits longer, better for slow speakers. 3 is today's tuning.",
  },
  {
    key: "bargeIn", section: "all", engines: ALL, kind: "toggle", default: D.bargeIn,
    doc: "Lets callers interrupt the agent mid-sentence. Off: the agent always finishes its sentence first.",
  },
  {
    key: "keyTerms", section: "all", engines: ALL, kind: "list", list: "terms",
    maxItems: LIMITS.terms.maxItems, maxLength: LIMITS.terms.maxLength, default: D.keyTerms,
    doc: "Words the agent must recognise and spell correctly (brand, treatment and street names). Used as a recognition hint; it doesn't change what the agent says.",
  },
  {
    key: "languageHint", section: "all", engines: ALL, kind: "select", options: LANGUAGE_HINTS,
    default: D.languageHint,
    doc: "Language the agent expects at the start of the call. 'auto' uses the business language. The caller can still switch unless the language is locked.",
  },
  {
    key: "voiceOverrides", section: "all", engines: ALL, kind: "text", default: D.voiceOverrides,
    doc: "Optional exact voice per engine (OpenAI, Gemini, Grok voice id). Empty = the closest voice of the same gender is picked automatically.",
  },
  {
    key: "minInterruptionMs", section: "ours", engines: ALL, kind: "number", min: 0, max: 2000, step: 50, unit: "ms",
    default: D.minInterruptionMs,
    doc: "How long the caller must talk over the agent before it stops. Raise it if coughs or 'mm-hm' stop the agent; lower it if callers struggle to interrupt.",
  },
  {
    key: "idleHangupSec", section: "ours", engines: ALL, kind: "number", min: 10, max: 120, step: 5, unit: "s",
    default: D.idleHangupSec,
    doc: "Hangs up after this much total silence on the line. The first 10 s of a call are never counted.",
  },
  {
    key: "maxDurationMin", section: "ours", engines: ALL, kind: "number", min: 1, max: 60, step: 1, unit: "min",
    default: D.maxDurationMin,
    doc: "Hard limit on call length; the call ends when it's reached. Protects against stuck lines.",
  },
  {
    key: "pace", section: "ours", engines: ALL, kind: "select", options: PACES, default: D.pace,
    doc: "Speaking pace. OpenAI applies it as a speed setting; Gemini and Grok follow it as a speaking instruction.",
  },
  {
    key: "pronunciations", section: "ours", engines: ALL, kind: "list", list: "pronunciations",
    maxItems: LIMITS.pronunciations.maxItems, maxTerm: LIMITS.pronunciations.maxTerm,
    maxSayAs: LIMITS.pronunciations.maxSayAs, default: D.pronunciations,
    doc: "How to say specific words (e.g. a brand name). Added to the agent's instructions; the model usually follows it but it isn't guaranteed.",
  },
  {
    key: "fillers", section: "ours", engines: ALL, kind: "toggle", default: D.fillers,
    doc: "Allows short fillers like 'let me check' while the agent looks something up. Off: the agent stays silent until it has the answer.",
  },
  {
    key: "speakingStyle", section: "ours", engines: ALL, kind: "text", maxLength: LIMITS.speakingStyle,
    default: D.speakingStyle,
    doc: "Free-text tone guidance added to the instructions (e.g. 'warm and concise').",
  },
  {
    key: "languageLock", section: "ours", engines: ALL, kind: "toggle", default: D.languageLock,
    doc: "Keeps the agent in the business language even if the caller switches language.",
  },
  {
    key: "openaiTurnMode", section: "engine", engines: ["openai"], kind: "select", options: OPENAI_TURN_MODES,
    default: D.openaiTurnMode,
    doc: "OpenAI only. 'server_vad' detects the end of a turn from silence (today); 'semantic_vad' also judges whether the sentence sounds finished.",
  },
  {
    key: "openaiEagerness", section: "engine", engines: ["openai"], kind: "select", options: OPENAI_EAGERNESS,
    visibleWhen: { key: "openaiTurnMode", equals: "semantic_vad" }, default: D.openaiEagerness,
    doc: "OpenAI semantic turn detection only. 'high' answers as soon as possible; 'low' lets callers finish long thoughts.",
  },
  {
    key: "openaiNoiseReduction", section: "engine", engines: ["openai"], kind: "select", options: OPENAI_NOISE,
    default: D.openaiNoiseReduction,
    doc: "OpenAI's own noise filter, on top of ours. 'off' is today (our filter already cleans the line); 'near_field' for headsets, 'far_field' for speakerphones.",
  },
  {
    key: "openaiReasoning", section: "engine", engines: ["openai"], kind: "select", options: OPENAI_REASONING,
    default: D.openaiReasoning,
    doc: "OpenAI gpt-realtime-2.1 thinking effort. 'default' = none on gpt-realtime-2, low on 2.1. Higher = better on complex requests, slower replies.",
  },
  {
    key: "grokReasoning", section: "engine", engines: ["xai"], kind: "select", options: GROK_REASONING,
    default: D.grokReasoning,
    doc: "Grok only. 'high' (xAI default) reasons before answering; 'none' skips it. Latency impact to be measured.",
  },
];

/**
 * Validates a partial admin write and merges it onto the stored profile.
 * null resets everything to the defaults (stored as NULL).
 */
export function mergeVoiceProfile(
  stored: unknown,
  patch: unknown,
): { ok: true; value: Partial<VoiceProfile> | null } | { ok: false; error: string } {
  if (patch === null) return { ok: true, value: null };
  const base = voiceProfileSchema.partial().safeParse(stored ?? {});
  const current = base.success ? base.data : {};
  const parsed = voiceProfileSchema.partial().safeParse(patch);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `voiceProfile.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, value: { ...current, ...parsed.data } };
}

/** The full profile the worker receives: stored values over the defaults. */
export function effectiveVoiceProfile(stored: unknown): VoiceProfile {
  const parsed = voiceProfileSchema.partial().safeParse(stored ?? {});
  return { ...DEFAULT_VOICE_PROFILE, ...(parsed.success ? parsed.data : {}) };
}
