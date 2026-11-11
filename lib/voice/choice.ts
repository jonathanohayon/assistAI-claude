// A customer's voice CHOICE, resolved server-side (V8b, receptionist only).
// Pure. The tenant sends OUR voice id (lib/voice/catalogue.ts) — never an
// engine voice name — and the server writes:
//   - voiceId (the legacy `voice` column the calls read on OpenAI): the
//     choice's OpenAI equivalent;
//   - advanced.voiceOverrides[<account engine>] when that engine is Gemini
//     or Grok: the choice's real voice there, so it no longer collapses by
//     gender (the worker already honours voiceOverrides). An OpenAI account
//     gets NO per-engine override. After an engine change the new engine
//     uses today's fallback until the next choice (to board).
// voiceOverrides stays admin-only for DIRECT writes (lib/voice/store.ts gate,
// checked on the tenant's own patch, before this runs).
// A save that doesn't choose a voice changes nothing here (byte-identical).

import type { RealtimeProvider } from "@/lib/realtime-provider";
import { catalogueIdFor, catalogueVoice, engineVoices, equivalentVoice } from "@/lib/voice/catalogue";
import type { Voice } from "@/lib/voice/contract";
import { VOICE_GENDER, VOICE_ORDER, type VoiceGender } from "@/lib/voice/public";

/**
 * `next` = the merged voice; `engine` = the account's engine. A voice is
 * CHOSEN when the patch's voiceId is one of our catalogue ids other than the
 * voice the calls use now on that engine, or an OpenAI voice name different
 * from the current one. Otherwise (no voiceId, or an unchanged re-send)
 * `next` is returned untouched.
 */
export function resolveVoiceChoice(current: Voice, next: Voice, patch: unknown, engine: RealtimeProvider): Voice {
  const requested =
    patch && typeof patch === "object" && typeof (patch as { voiceId?: unknown }).voiceId === "string"
      ? (patch as { voiceId: string }).voiceId.trim()
      : null;
  if (!requested) return next;
  // Re-sending the voice the calls already use is not a choice.
  // (Our id never reaches the voice column: the stored name is kept.)
  if (catalogueVoice(requested) && requested === catalogueIdFor(engine, effectiveEngineVoiceName(current, engine))) {
    return { ...next, voiceId: current.voiceId };
  }
  const id = catalogueVoice(requested)
    ? requested
    : requested !== current.voiceId
      ? catalogueIdFor("openai", requested)
      : null;
  if (!id) return next; // unchanged OpenAI name, or unknown (the route's allow-list refuses it)
  const openai = equivalentVoice(id, "openai")!;
  // An override set for an engine is replaced by the choice; the others
  // (admin-set) are left as they are. OpenAI account: the choice IS the
  // voice column — NO per-engine override is written.
  const overrides = { ...next.advanced.voiceOverrides };
  delete overrides[engine];
  if (engine !== "openai") overrides[engine] = equivalentVoice(id, engine)!.name;
  return { ...next, voiceId: openai.name, advanced: { ...next.advanced, voiceOverrides: overrides } };
}

// ── What the calls use TODAY on each engine (to show the current choice) ──
// Mirror of the worker's fallback (src/realtime-provider.ts): an override
// wins; else three OpenAI voices have their own mapping; else by gender.
const WORKER_MAP: Partial<Record<RealtimeProvider, Record<string, string>>> = {
  gemini: { marin: "Sulafat", cedar: "Achird", coral: "Aoede" },
  xai: { marin: "eve", cedar: "rex", coral: "ara" },
};
const WORKER_DEFAULT: Partial<Record<RealtimeProvider, Record<VoiceGender, string>>> = {
  gemini: { f: "Kore", m: "Charon" },
  xai: { f: "eve", m: "rex" },
};

export function effectiveEngineVoiceName(voice: Voice, engine: RealtimeProvider): string {
  const o = voice.advanced.voiceOverrides[engine]?.trim();
  if (o) return o;
  if (engine === "openai") return voice.voiceId;
  const gender = VOICE_GENDER[voice.voiceId] === "m" ? "m" : "f";
  return WORKER_MAP[engine]?.[voice.voiceId] ?? WORKER_DEFAULT[engine]![gender];
}

// ── Tenant-safe view: our ids only, no engine voice name, no engine ────

export interface VoiceOption {
  id: string;
  /** Customer-facing "Voice N": OpenAI = today's VOICE_ORDER position (names unchanged); others = stable per engine. */
  number: number;
  gender: VoiceGender;
  recommended: boolean;
  /** Only when the sample IS the voice the calls use (a recording of this engine's real voice). */
  sampleUrl?: string;
}

export interface TenantVoiceChoice {
  /** Our id of the voice the calls use now (null = not in the catalogue). */
  current: string | null;
  /** The usable voices of the account's engine. */
  options: VoiceOption[];
}

/**
 * The sample recorded for THIS catalogue voice (OpenAI voices are keyed by
 * name, Gemini / Grok voices by our id — so a lookup can only ever return a
 * recording of that engine's real voice): url, or null.
 */
export type SampleLookup = (voice: { id: string; name: string; engine: RealtimeProvider }) => string | null;

export function voiceNumber(v: { engine: RealtimeProvider; name: string; id: string }): number {
  if (v.engine === "openai") return (VOICE_ORDER as readonly string[]).indexOf(v.name) + 1;
  return Number(v.id.slice("voice-".length)) - (v.engine === "gemini" ? 200 : 300);
}

export function tenantVoiceChoice(voice: Voice, engine: RealtimeProvider, sample: SampleLookup = () => null): TenantVoiceChoice {
  return {
    current: catalogueIdFor(engine, effectiveEngineVoiceName(voice, engine)),
    options: engineVoices(engine)
      .filter((v) => v.available)
      .map((v) => {
        const url = sample(v);
        return { id: v.id, number: voiceNumber(v), gender: v.gender, recommended: v.recommendedRank !== null, ...(url ? { sampleUrl: url } : {}) };
      }),
  };
}

// ── Engine switch (V8e, admin-only) ────────────────────────────────────

/** The engine a voice runs on ("auto" = OpenAI, as served). */
export function voiceEngineOf(voice: Voice): RealtimeProvider {
  return voice.engine === "auto" ? "openai" : voice.engine;
}

/**
 * When an admin switches the account's engine, the voice the calls used on
 * the old engine follows to its closest equivalent on the new one (same
 * gender; recommended rank ↔ rank — lib/voice/catalogue.ts). Without this,
 * switching to Grok silently moved every voice to the gender fallback.
 *   → OpenAI: the voice column takes the equivalent; no OpenAI override.
 *   → Gemini / Grok: that engine's override takes the equivalent.
 * The old engine's override is kept, so switching back restores it. A voice
 * outside the catalogue (an admin's custom name) is left as it is.
 */
export function voiceAfterEngineSwitch(voice: Voice, from: RealtimeProvider, to: RealtimeProvider): Voice {
  if (from === to) return voice;
  const srcId = catalogueIdFor(from, effectiveEngineVoiceName(voice, from));
  const target = srcId ? equivalentVoice(srcId, to) : null;
  if (!target) return voice;
  const overrides = { ...voice.advanced.voiceOverrides };
  delete overrides[to];
  if (to === "openai") return { ...voice, voiceId: target.name, advanced: { ...voice.advanced, voiceOverrides: overrides } };
  overrides[to] = target.name;
  return { ...voice, advanced: { ...voice.advanced, voiceOverrides: overrides } };
}
