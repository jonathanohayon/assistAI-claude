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
export const DEFAULT_VOICE_ID = "marin";

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
