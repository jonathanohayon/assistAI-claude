// Voice brick — screen-side helpers over the V1 contract (lib/voice/contract).
// Pure and client-safe: no supplier names (the admin engine mapping lives in
// voice-admin.ts, loaded for admins only).

import { VOICE_GENDER, type Voice, type VoiceGender } from "@/lib/voice/contract";

/** Six recommended voices shown first: three female, three male. */
export const RECOMMENDED_VOICES: readonly string[] = ["marin", "coral", "sage", "cedar", "ballad", "ash"];

export type GenderFilter = VoiceGender | "all";

export const genderOf = (voiceId: string): VoiceGender => VOICE_GENDER[voiceId] ?? "m";

/** Recommended first, the rest only with "all voices"; the selected one always shows. */
export function pickerVoices(
  available: readonly string[],
  opts: { gender: GenderFilter; showAll: boolean; selected: string },
): string[] {
  const inGender = (v: string) => opts.gender === "all" || genderOf(v) === opts.gender;
  const recommended = RECOMMENDED_VOICES.filter((v) => available.includes(v) && inGender(v));
  const rest = available.filter((v) => !RECOMMENDED_VOICES.includes(v) && inGender(v));
  const list = opts.showAll ? [...recommended, ...rest] : [...recommended];
  if (available.includes(opts.selected) && !list.includes(opts.selected) && inGender(opts.selected)) {
    list.push(opts.selected);
  }
  return list;
}

/**
 * Patience on screen: 1 = answers quickly … 5 = waits longest. The contract
 * keeps today's sensitivity scale (1 waits longest, 5 answers soonest), so
 * the screen shows it flipped.
 */
export const patienceToScreen = (patience: number): number => 6 - patience;
export const screenToPatience = (screen: number): number => 6 - screen;

export const KEY_TERM_MAX = { items: 50, length: 40 } as const;
export const PRONUNCIATION_MAX = { items: 50, term: 40, sayAs: 80 } as const;

/** Trimmed, capped, no case-insensitive duplicates, max count. */
export function addKeyTerm(terms: readonly string[], raw: string): string[] {
  const v = raw.trim().slice(0, KEY_TERM_MAX.length);
  if (!v || terms.length >= KEY_TERM_MAX.items) return [...terms];
  if (terms.some((t) => t.toLowerCase() === v.toLowerCase())) return [...terms];
  return [...terms, v];
}

export function addPronunciation(
  list: Voice["pronunciations"],
  term: string,
  sayAs: string,
): Voice["pronunciations"] {
  const t = term.trim().slice(0, PRONUNCIATION_MAX.term);
  const s = sayAs.trim().slice(0, PRONUNCIATION_MAX.sayAs);
  if (!t || !s || list.length >= PRONUNCIATION_MAX.items) return list;
  // Same term again replaces its pronunciation.
  return [...list.filter((p) => p.term.toLowerCase() !== t.toLowerCase()), { term: t, sayAs: s }];
}

/** Our own level-3 fields, shown to any tenant in developer mode. */
export const OUR_ADVANCED_FIELDS = ["minInterruptionMs", "idleHangupSec", "maxDurationMin"] as const;
export const ADVANCED_LIMITS = {
  minInterruptionMs: { min: 0, max: 2000, step: 100, unit: "ms" },
  idleHangupSec: { min: 10, max: 120, step: 5, unit: "s" },
  maxDurationMin: { min: 1, max: 60, step: 1, unit: "min" },
} as const;

/** Level 3 for tenants follows their developer mode; admins always see it. */
export function showLevel3(opts: { isAdmin: boolean; developerMode: boolean }): boolean {
  return opts.isAdmin || opts.developerMode;
}
