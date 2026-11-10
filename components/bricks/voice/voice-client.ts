// Voice brick — the TENANT-SAFE subset of the V1 contract (lib/voice/contract).
//
// Tenant pages must never ship a supplier name (production-build grep,
// scripts/check-tenant-bundle.mjs). The full contract can't be imported in
// tenant code: its schema and defaults carry supplier-named fields. So the
// screen works on what a tenant is served (voiceForViewer) with this subset,
// and the server stays the authority (mergeVoice validates every write).
//
// Everything here is a COPY of the contract, pinned by
// scripts/tests/voice-brick.test.ts: values, defaults and merge results must
// equal the contract's, so a change there fails the test until mirrored.
// Only `import type` from the contract is allowed (erased at build time).

import type { Voice } from "@/lib/voice/contract";

export type ClientVoice = Omit<Voice, "engine" | "advanced"> & {
  /** Present for admins only (served full voice). */
  engine?: Voice["engine"];
  /** Tenants: our fields only. Admins: every field. */
  advanced: Partial<Voice["advanced"]> &
    Pick<Voice["advanced"], "speed" | "minInterruptionMs" | "idleHangupSec" | "maxDurationMin">;
};

export type VoiceGender = "f" | "m";

export const VOICE_GENDER: Readonly<Record<string, VoiceGender>> = {
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
export const VOICE_IDS: readonly string[] = Object.keys(VOICE_GENDER);

export const VOICE_STYLES = ["warm", "professional", "dynamic", "calm"] as const;
export const STYLE_SELECTOR_TENANT_VISIBLE = false;
export const VOICE_PACES = ["slow", "normal", "fast"] as const;

/** Tenant-visible defaults (= today's behaviour). */
export const CLIENT_DEFAULT_VOICE: ClientVoice = {
  version: 1,
  voiceId: "marin",
  style: "warm",
  pace: "normal",
  patience: 3,
  bargeIn: true,
  keyTerms: [],
  pronunciations: [],
  noiseReduction: 8,
  languageLock: false,
  advanced: {
    speed: null,
    languageHint: "auto",
    minInterruptionMs: 500,
    idleHangupSec: 30,
    maxDurationMin: 30,
    fillers: true,
    speakingStyle: "",
  },
};

const LIMITS = {
  voiceId: 40,
  keyTerms: { items: 50, length: 40 },
  pronunciations: { items: 50, term: 40, sayAs: 80 },
  minInterruptionMs: [0, 2000],
  idleHangupSec: [10, 120],
  maxDurationMin: [1, 60],
} as const;

export type ClientVoiceParse = { ok: true; value: ClientVoice } | { ok: false; error: string };

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** The checks the screen can trip; the server re-validates everything. */
function check(v: ClientVoice): string | null {
  if (typeof v.voiceId !== "string" || !v.voiceId.trim() || v.voiceId.length > LIMITS.voiceId) return "voiceId";
  if (!(VOICE_STYLES as readonly string[]).includes(v.style)) return "style";
  if (!(VOICE_PACES as readonly string[]).includes(v.pace)) return "pace";
  if (!isInt(v.patience, 1, 5)) return "patience";
  if (!isInt(v.noiseReduction, 1, 10)) return "noiseReduction";
  if (typeof v.bargeIn !== "boolean" || typeof v.languageLock !== "boolean") return "toggle";
  if (
    !Array.isArray(v.keyTerms) ||
    v.keyTerms.length > LIMITS.keyTerms.items ||
    v.keyTerms.some((t) => typeof t !== "string" || !t.trim() || t.trim().length > LIMITS.keyTerms.length)
  )
    return "keyTerms";
  if (
    !Array.isArray(v.pronunciations) ||
    v.pronunciations.length > LIMITS.pronunciations.items ||
    v.pronunciations.some(
      (p) =>
        !p.term?.trim() ||
        !p.sayAs?.trim() ||
        p.term.trim().length > LIMITS.pronunciations.term ||
        p.sayAs.trim().length > LIMITS.pronunciations.sayAs,
    )
  )
    return "pronunciations";
  const a = v.advanced;
  for (const k of ["minInterruptionMs", "idleHangupSec", "maxDurationMin"] as const) {
    const [min, max] = LIMITS[k];
    if (!isInt(a[k], min, max)) return `advanced.${k}`;
  }
  return null;
}

/**
 * Same merge as the contract's mergeVoice: `advanced` key by key, and
 * picking a pace clears a kept custom speed unless the write sets one.
 */
export function mergeClientVoice(stored: ClientVoice, patch: Record<string, unknown>): ClientVoiceParse {
  const advancedPatch =
    patch.advanced && typeof patch.advanced === "object" ? (patch.advanced as Record<string, unknown>) : {};
  const next = {
    ...stored,
    ...patch,
    version: 1,
    advanced: { ...stored.advanced, ...advancedPatch },
  } as ClientVoice;
  if ("pace" in patch && !("speed" in advancedPatch)) next.advanced = { ...next.advanced, speed: null };
  const bad = check(next);
  return bad ? { ok: false, error: `voice.${bad}: invalid` } : { ok: true, value: next };
}

export const isCustomPace = (v: Pick<ClientVoice, "advanced">): boolean => v.advanced.speed !== null;
