// Tenant-safe part of the Voice brick: what the dashboard screen needs, with
// NO supplier name in code or strings (it ships in the tenant bundle — a
// test greps this file and lib/voice/samples.ts). The full contract
// (lib/voice/contract.ts: schema, engine-specific fields, presets) re-exports
// these and must not be imported by tenant code.

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

/**
 * Customer-facing voice numbers ("Voice 1"…): each voice's position here.
 * Supplier voice ids never reach the UI. APPEND ONLY — reordering would
 * rename every customer's voice. (Moved from lib/use-voice-label.ts.)
 */
export const VOICE_ORDER = [
  "marin",
  "cedar",
  "coral",
  "sage",
  "shimmer",
  "nova",
  "ballad",
  "verse",
  "alloy",
  "echo",
  "ash",
  "fable",
  "onyx",
] as const;
export const DEFAULT_VOICE_ID = "marin";

// ── Pace (V9a): 5 notches ───────────────────────────────────────────────

export const VOICE_PACES = ["very_slow", "slow", "normal", "fast", "very_fast"] as const;
export type VoicePace = (typeof VOICE_PACES)[number];

/**
 * Speed factor of each pace (engines without a speed setting get the pace in
 * words). slow / normal / fast = TODAY's values (applied by the voice agent);
 * the two ends are folded in when serving (lib/voice/engine.ts).
 * The two ends are PROVISIONAL until heard: tune them here only.
 */
export const PACE_SPEED: Record<VoicePace, number> = { very_slow: 0.8, slow: 0.9, normal: 1, fast: 1.15, very_fast: 1.3 };

// ── Styles ──────────────────────────────────────────────────────────────

export const VOICE_STYLES = ["warm", "professional", "dynamic", "calm"] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];
/** "warm" = today's behaviour, exactly. */
export const DEFAULT_VOICE_STYLE: VoiceStyle = "warm";
/** Tenants can't pick a style until V6 is tuned and heard by Jonathan. Admins can. */
export const STYLE_SELECTOR_TENANT_VISIBLE = false;

// ── Samples (V7) ────────────────────────────────────────────────────────

/** Recommended voices, 3 female + 3 male, interleaved (picker and samples). */
export const RECOMMENDED_VOICE_IDS = ["marin", "cedar", "coral", "ballad", "sage", "ash"] as const;
export const SAMPLE_LANGUAGES = ["fr", "he", "en"] as const;
export type SampleLanguage = (typeof SAMPLE_LANGUAGES)[number];
