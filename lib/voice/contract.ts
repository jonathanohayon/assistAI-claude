// The Voice contract (v1): ONE structure, `voice`, describing how an agent
// sounds and listens, for every agent type (receptionist, outbound agents,
// third-party agent). CLIENT-SAFE: pure, no I/O — the dashboard screen
// imports it for defaults, levels and validation.
//
// Rules:
//   - Every default equals TODAY's behaviour, so a voice built from legacy
//     data sends the engine exactly the same settings (lib/voice/adapters.ts,
//     proven in scripts/tests/voice-contract.test.ts).
//   - Customers never see a provider name. `engine` is level 3 and its
//     choice stays admin-only.
//   - "warm" is today's behaviour. The style selector is hidden from
//     tenants (STYLE_SELECTOR_TENANT_VISIBLE) until the styles are tuned and
//     heard (step V6).

import { z } from "zod";

import {
  DEFAULT_VOICE_PROFILE,
  GROK_REASONING,
  LANGUAGE_HINTS,
  OPENAI_EAGERNESS,
  OPENAI_NOISE,
  OPENAI_REASONING,
  OPENAI_TURN_MODES,
  PACES,
} from "@/lib/voice-profile";

export const VOICE_CONTRACT_VERSION = 1 as const;

// ── Voices ──────────────────────────────────────────────────────────────
// Voices are identified by their OpenAI id; the worker maps them to Gemini
// and Grok voices by gender. Shown to customers as "Voice 1, Voice 2…".

export type VoiceGender = "f" | "m";

/** Gender of each voice — the ONE table (lib/voice-tuning re-exports it). */
export const VOICE_GENDER: Record<string, VoiceGender> = {
  marin: "f",
  cedar: "m",
  ballad: "m",
  sage: "f",
  verse: "m",
  alloy: "m",
  shimmer: "f",
  echo: "m",
  fable: "m",
  onyx: "m",
  nova: "f",
  coral: "f",
  ash: "m",
};

export const VOICE_IDS = Object.keys(VOICE_GENDER);
export const DEFAULT_VOICE_ID = "marin";

// ── Styles ──────────────────────────────────────────────────────────────

export const VOICE_STYLES = ["warm", "professional", "dynamic", "calm"] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];
/** "warm" = today's behaviour, exactly. */
export const DEFAULT_VOICE_STYLE: VoiceStyle = "warm";
/** Tenants can't pick a style until V6 is tuned and heard by Jonathan. Admins can. */
export const STYLE_SELECTOR_TENANT_VISIBLE = false;

// ── Engine ──────────────────────────────────────────────────────────────

export const VOICE_ENGINES = ["auto", "openai", "gemini", "xai"] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

// ── Limits ──────────────────────────────────────────────────────────────

const L = {
  voiceId: 40,
  keyTerms: { items: 50, length: 40 },
  pronunciations: { items: 50, term: 40, sayAs: 80 },
  speakingStyle: 300,
  model: 80,
} as const;

// ── Schema ──────────────────────────────────────────────────────────────

const advancedSchema = z
  .object({
    /**
     * Custom speed kept EXACTLY from legacy data (e.g. 1.13). While set, it
     * wins over the pace preset as the base speed; the screen shows "custom".
     * Picking a pace clears it.
     */
    // Wide range on purpose: any legacy value is kept as is (the worker clamps).
    speed: z.number().min(0.25).max(4).nullable(),
    /** Engine model id (e.g. gpt-realtime-2); null = the call type's default. */
    model: z.string().trim().min(1).max(L.model).nullable(),
    languageHint: z.enum(LANGUAGE_HINTS),
    voiceOverrides: z
      .object({
        openai: z.string().trim().max(L.voiceId).optional(),
        gemini: z.string().trim().max(L.voiceId).optional(),
        xai: z.string().trim().max(L.voiceId).optional(),
      })
      .strict(),
    minInterruptionMs: z.number().int().min(0).max(2000),
    idleHangupSec: z.number().int().min(10).max(120),
    maxDurationMin: z.number().int().min(1).max(60),
    fillers: z.boolean(),
    speakingStyle: z.string().max(L.speakingStyle),
    openaiTurnMode: z.enum(OPENAI_TURN_MODES),
    openaiEagerness: z.enum(OPENAI_EAGERNESS),
    openaiNoiseReduction: z.enum(OPENAI_NOISE),
    openaiReasoning: z.enum(OPENAI_REASONING),
    grokReasoning: z.enum(GROK_REASONING),
  })
  .strict();

export const voiceSchema = z
  .object({
    version: z.literal(VOICE_CONTRACT_VERSION),
    voiceId: z.string().trim().min(1).max(L.voiceId),
    style: z.enum(VOICE_STYLES),
    pace: z.enum(PACES),
    /** = today's turnSensitivity: 1 waits longest, 5 answers soonest. */
    patience: z.number().int().min(1).max(5),
    bargeIn: z.boolean(),
    keyTerms: z.array(z.string().trim().min(1).max(L.keyTerms.length)).max(L.keyTerms.items),
    pronunciations: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(L.pronunciations.term),
            sayAs: z.string().trim().min(1).max(L.pronunciations.sayAs),
          })
          .strict(),
      )
      .max(L.pronunciations.items),
    /** Our noise filter strength, 1–10 (today's noise_reduction_level). */
    noiseReduction: z.number().int().min(1).max(10),
    languageLock: z.boolean(),
    engine: z.enum(VOICE_ENGINES),
    advanced: advancedSchema,
  })
  .strict();

export type Voice = z.infer<typeof voiceSchema>;
export type VoiceAdvanced = Voice["advanced"];

const P = DEFAULT_VOICE_PROFILE;

/** Today's behaviour for a receptionist with no settings. */
export const DEFAULT_VOICE: Voice = {
  version: VOICE_CONTRACT_VERSION,
  voiceId: DEFAULT_VOICE_ID,
  style: DEFAULT_VOICE_STYLE,
  pace: P.pace,
  patience: P.turnSensitivity,
  bargeIn: P.bargeIn,
  keyTerms: [],
  pronunciations: [],
  noiseReduction: 8,
  languageLock: P.languageLock,
  engine: "auto",
  advanced: {
    speed: null,
    model: null,
    languageHint: P.languageHint,
    voiceOverrides: {},
    minInterruptionMs: P.minInterruptionMs,
    idleHangupSec: P.idleHangupSec,
    maxDurationMin: P.maxDurationMin,
    fillers: P.fillers,
    speakingStyle: P.speakingStyle,
    openaiTurnMode: P.openaiTurnMode,
    openaiEagerness: P.openaiEagerness,
    openaiNoiseReduction: P.openaiNoiseReduction,
    openaiReasoning: P.openaiReasoning,
    grokReasoning: P.grokReasoning,
  },
};

// ── Levels (what the screen shows where) ───────────────────────────────
// 1 = Essential (always visible) · 2 = "More settings" (collapsed) ·
// 3 = developer mode. `engine` is level 3 AND admin-only.

export type VoiceLevel = 1 | 2 | 3;

export const VOICE_FIELD_LEVEL: Record<Exclude<keyof Voice, "version">, VoiceLevel> = {
  voiceId: 1,
  style: 1,
  pace: 2,
  patience: 2,
  bargeIn: 2,
  keyTerms: 2,
  pronunciations: 2,
  noiseReduction: 2,
  languageLock: 2,
  engine: 3,
  advanced: 3,
};

/** Fields only an admin may change, whatever the account's developer mode. */
export const VOICE_ADMIN_ONLY_FIELDS: ReadonlyArray<keyof Voice> = ["engine"];

// ── Pace: preset vs custom ─────────────────────────────────────────────

export type PaceMode = "preset" | "custom";

/** "custom" while a legacy custom speed is kept (it wins over the preset). */
export function paceMode(v: Pick<Voice, "advanced">): PaceMode {
  return v.advanced.speed === null ? "preset" : "custom";
}

// ── Validation ──────────────────────────────────────────────────────────

export type VoiceParse = { ok: true; value: Voice } | { ok: false; error: string };

/** Strict check of a full voice (what we store). */
export function parseVoice(raw: unknown): VoiceParse {
  const r = voiceSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `voice.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
}

/**
 * Applies a partial write (screen save) onto a stored voice; `advanced` is
 * merged key by key. Picking a pace clears the custom speed unless the same
 * write sets one.
 */
export function mergeVoice(stored: Voice, patch: unknown): VoiceParse {
  if (!patch || typeof patch !== "object") return { ok: false, error: "voice: invalid" };
  const p = patch as Record<string, unknown>;
  const advancedPatch = p.advanced && typeof p.advanced === "object" ? (p.advanced as Record<string, unknown>) : {};
  const next: Record<string, unknown> = {
    ...stored,
    ...p,
    version: VOICE_CONTRACT_VERSION,
    advanced: { ...stored.advanced, ...advancedPatch },
  };
  if ("pace" in p && !("speed" in advancedPatch)) {
    (next.advanced as Record<string, unknown>).speed = null;
  }
  return parseVoice(next);
}

// ── Shared rules (web ↔ worker) ────────────────────────────────────────
// The data the worker must agree on, as plain JSON. Committed as
// lib/voice/contract.json and vendored byte-for-byte by the worker
// (src/voice/contract.json). Tests on BOTH sides fail as soon as the TS and
// the JSON, or the two JSON copies, differ.

export function voiceContractRules() {
  return {
    version: VOICE_CONTRACT_VERSION,
    voiceGender: VOICE_GENDER,
    defaultVoiceId: DEFAULT_VOICE_ID,
    styles: [...VOICE_STYLES],
    defaultStyle: DEFAULT_VOICE_STYLE,
    engines: [...VOICE_ENGINES],
    fieldLevel: VOICE_FIELD_LEVEL,
    defaultVoice: DEFAULT_VOICE,
  };
}
