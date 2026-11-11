// Voice brick — screen-side helpers over the tenant-safe contract subset
// (voice-client.ts). Pure and client-safe: no supplier names (the admin
// engine mapping lives in voice-admin.ts, loaded for admins only).

import { PACE_SPEED } from "@/lib/voice/public";

import { CLIENT_DEFAULT_VOICE, RECOMMENDED_VOICE_IDS, VOICE_GENDER, VOICE_PACES, type ClientVoice, type VoiceGender } from "./voice-client";

/**
 * Six recommended voices shown first, three female and three male,
 * interleaved so the two-column grid reads female | male on every row.
 * Same list as the voice samples (lib/voice/public).
 */
export const RECOMMENDED_VOICES: readonly string[] = RECOMMENDED_VOICE_IDS;

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
 * The voice choice as the server serves it (V8c, receptionist): OUR ids for
 * the account's engine — no engine name, no engine voice name. Mirror of
 * lib/voice/choice.ts (server-only, not importable here).
 */
export interface ServedVoiceOption {
  id: string;
  /** Customer-facing "Voice N", from the server (never a list position). */
  number: number;
  gender: VoiceGender;
  recommended: boolean;
  /** Only when it plays the voice the calls really use. */
  sampleUrl?: string;
}
export interface ServedVoiceChoice {
  current: string | null;
  options: ServedVoiceOption[];
}

/** Our ids 101–199 are the voices with a descriptor in our copy; others show number + gender only. */
export const hasDescriptor = (id: string): boolean => /^voice-1\d\d$/.test(id);

/** The selected option: the unsaved pick if it is one of ours, else what the calls use now. */
export function selectedChoice(choice: ServedVoiceChoice, voiceId: string): string | null {
  return choice.options.some((o) => o.id === voiceId) ? voiceId : choice.current;
}

/**
 * Short list = the server's recommended voices, female | male per row; the
 * rest only with "all voices"; the selected one always shows.
 */
export function choiceVoices(
  choice: ServedVoiceChoice,
  opts: { gender: GenderFilter; showAll: boolean; selected: string | null },
): ServedVoiceOption[] {
  const inGender = (o: ServedVoiceOption) => opts.gender === "all" || o.gender === opts.gender;
  const rec = choice.options.filter((o) => o.recommended && inGender(o));
  const f = rec.filter((o) => o.gender === "f");
  const m = rec.filter((o) => o.gender === "m");
  const interleaved: ServedVoiceOption[] = [];
  for (let i = 0; i < Math.max(f.length, m.length); i++) {
    if (f[i]) interleaved.push(f[i]);
    if (m[i]) interleaved.push(m[i]);
  }
  const list = opts.showAll ? [...interleaved, ...choice.options.filter((o) => !o.recommended && inGender(o))] : interleaved;
  const sel = choice.options.find((o) => o.id === opts.selected);
  if (sel && !list.includes(sel) && inGender(sel)) list.push(sel);
  return list;
}

// ── Pace slider (V9b) ────────────────────────────────────────────────
export type Pace = (typeof VOICE_PACES)[number];

// The speed each notch stands for (V9a): to place a legacy custom speed on the nearest notch.
export { PACE_SPEED };

/** Where the slider sits: the pace's notch, or the nearest one to a custom speed (shown as "Custom"). */
export function paceNotch(v: Pick<ClientVoice, "pace" | "advanced">): { index: number; custom: boolean } {
  const speed = v.advanced.speed;
  if (speed === null) return { index: Math.max(0, VOICE_PACES.indexOf(v.pace as Pace)), custom: false };
  let best = 0;
  VOICE_PACES.forEach((p, i) => {
    if (Math.abs(PACE_SPEED[p] - speed) < Math.abs(PACE_SPEED[VOICE_PACES[best]] - speed)) best = i;
  });
  return { index: best, custom: true };
}

/** The exact speed in developer settings (contract bounds). */
export const SPEED_LIMITS = { min: 0.25, max: 4 } as const;

/** "Reset" shows only when the slider isn't on plain Normal. */
export const paceResettable = (v: Pick<ClientVoice, "pace" | "advanced">): boolean => v.pace !== "normal" || v.advanced.speed !== null;

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
  list: ClientVoice["pronunciations"],
  term: string,
  sayAs: string,
): ClientVoice["pronunciations"] {
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

/**
 * Radio group keyboard pattern (WAI-ARIA): one tab stop per group, arrows
 * move AND select, mirrored in right-to-left, Home/End jump to the ends.
 * Returns the id to select, or null when the key isn't handled.
 */
export function radioKeyTarget(
  key: string,
  ids: readonly string[],
  current: string,
  rtl: boolean,
): string | null {
  if (ids.length === 0) return null;
  const i = Math.max(0, ids.indexOf(current));
  const next = (d: number) => ids[(i + d + ids.length) % ids.length];
  switch (key) {
    case "ArrowDown":
      return next(1);
    case "ArrowUp":
      return next(-1);
    case "ArrowRight":
      return next(rtl ? -1 : 1);
    case "ArrowLeft":
      return next(rtl ? 1 : -1);
    case "Home":
      return ids[0];
    case "End":
      return ids[ids.length - 1];
    default:
      return null;
  }
}

/** A voiceConfig as the API serves it (tenants: our fields only). */
export type ServedVoice = ClientVoice;

/** Screen value: what the viewer was served, with tenant-visible defaults filled in. */
export function hydrateVoice(served: Partial<ClientVoice> | null | undefined): ClientVoice {
  if (!served) return CLIENT_DEFAULT_VOICE;
  return {
    ...CLIENT_DEFAULT_VOICE,
    ...served,
    advanced: { ...CLIENT_DEFAULT_VOICE.advanced, ...(served.advanced ?? {}) },
  } as ClientVoice;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed since `base` (last loaded or saved), as the partial the API
 * takes: top-level fields as a whole, `advanced` key by key. Unchanged
 * fields are never sent, so a tenant never sends an admin-only field.
 * null = nothing changed.
 */
export function voicePatch(base: ClientVoice, next: ClientVoice): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next) as Array<keyof ClientVoice>) {
    if (k === "version" || k === "advanced") continue;
    if (!same(base[k], next[k])) patch[k] = next[k];
  }
  const adv: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base.advanced), ...Object.keys(next.advanced)]) as Set<keyof ClientVoice["advanced"]>;
  for (const k of keys) {
    if (!same(base.advanced[k], next.advanced[k])) adv[k] = next.advanced[k];
  }
  if (Object.keys(adv).length) patch.advanced = adv;
  return Object.keys(patch).length ? patch : null;
}
