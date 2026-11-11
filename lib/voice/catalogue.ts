// The voice CATALOGUE per engine (brick Voice, V8a). SERVER / ADMIN side:
// it holds the engines' real voice names, so tenant code must NOT import it
// (scripts/tests/voice-catalogue.test.ts guards that). Nothing reads it on a
// call yet (V8a = no behaviour change; V8b resolves our ids server-side).
//
// Why: a customer's voice is stored as an OpenAI name, and for Gemini and
// Grok only marin / cedar / coral had their own mapping — the rest fell back
// by gender, so on Grok all 13 voices collapsed to 3 and the 6 recommended
// cards were really 2 female + 1 male.
//
// Sources (cite when editing):
//   - Grok (xai): GET https://api.x.ai/v1/tts/voices, read 11/11/2026 —
//     28 voices, `gender` per voice. xAI documents no per-voice description
//     (docs.x.ai voice-agent / text-to-speech / REST reference): null.
//   - Gemini: names + style labels, https://aistudio.google.com/docs/speech-generation
//     ("Voice options"); genders from Google Cloud's Chirp 3: HD table
//     (same 30 names), https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd.
//   - OpenAI: OpenAI publishes no gender or description per voice. The
//     genders are OUR table (lib/voice/public.ts VOICE_GENDER, in production
//     since V1); descriptors null.
//
// IDS ARE STABLE: never renumber or reuse one. Append new voices at the end
// of their engine's block (openai 101+, gemini 201+, xai 301+).

import { PROVIDERS } from "@/lib/realtime";
import type { RealtimeProvider } from "@/lib/realtime-provider";
import { VOICE_GENDER, type VoiceGender } from "@/lib/voice/public";

export interface CatalogueVoice {
  /** Our stable id — what a customer's choice is stored as (V8b). */
  id: string;
  engine: RealtimeProvider;
  /** The engine's real voice name. */
  name: string;
  gender: VoiceGender;
  /** The provider's own description; null when the provider documents none. */
  descriptor: string | null;
  /** Rank among the engine's recommended voices of that gender (1–3), null = not recommended. */
  recommendedRank: 1 | 2 | 3 | null;
  /**
   * Usable on a live call. OpenAI's realtime API doesn't offer fable, onyx
   * or nova (lib/realtime.ts allow-list): never offered, never an
   * equivalence target.
   */
  available: boolean;
}

const OPENAI_ORDER = ["marin", "cedar", "ballad", "sage", "verse", "alloy", "shimmer", "echo", "fable", "onyx", "nova", "coral", "ash"];
/** Recommended, per gender, in rank order (aligned across engines: rank r ↔ rank r). */
const OPENAI_REC: Record<VoiceGender, string[]> = { f: ["marin", "coral", "sage"], m: ["cedar", "ballad", "ash"] };

const GEMINI: [string, VoiceGender, string][] = [
  ["Achernar", "f", "Soft"], ["Achird", "m", "Friendly"], ["Algenib", "m", "Gravelly"], ["Algieba", "m", "Smooth"],
  ["Alnilam", "m", "Firm"], ["Aoede", "f", "Breezy"], ["Autonoe", "f", "Bright"], ["Callirrhoe", "f", "Easy-going"],
  ["Charon", "m", "Informative"], ["Despina", "f", "Smooth"], ["Enceladus", "m", "Breathy"], ["Erinome", "f", "Clear"],
  ["Fenrir", "m", "Excitable"], ["Gacrux", "f", "Mature"], ["Iapetus", "m", "Clear"], ["Kore", "f", "Firm"],
  ["Laomedeia", "f", "Upbeat"], ["Leda", "f", "Youthful"], ["Orus", "m", "Firm"], ["Pulcherrima", "f", "Forward"],
  ["Puck", "m", "Upbeat"], ["Rasalgethi", "m", "Informative"], ["Sadachbia", "m", "Lively"], ["Sadaltager", "m", "Knowledgeable"],
  ["Schedar", "m", "Even"], ["Sulafat", "f", "Warm"], ["Umbriel", "m", "Easy-going"], ["Vindemiatrix", "f", "Gentle"],
  ["Zephyr", "f", "Bright"], ["Zubenelgenubi", "m", "Casual"],
];
// marin→Sulafat (Warm), cedar→Achird (Friendly), coral→Aoede (Breezy) are
// today's worker mapping; Kore and Charon are its gender defaults.
const GEMINI_REC: Record<VoiceGender, string[]> = { f: ["Sulafat", "Aoede", "Kore"], m: ["Achird", "Charon", "Puck"] };

const GROK: [string, VoiceGender][] = [
  ["altair", "m"], ["ara", "f"], ["atlas", "m"], ["aurora", "f"], ["carina", "f"], ["castor", "m"], ["celeste", "f"],
  ["cosmo", "m"], ["eve", "f"], ["helios", "m"], ["helix", "m"], ["iris", "f"], ["kepler", "m"], ["leo", "m"],
  ["liora", "f"], ["lumen", "m"], ["luna", "f"], ["lux", "m"], ["naksh", "m"], ["orion", "m"], ["perseus", "m"],
  ["rex", "m"], ["rigel", "m"], ["sal", "m"], ["sirius", "m"], ["ursa", "f"], ["zagan", "m"], ["zenith", "m"],
];
// eve (xAI's default), rex, ara = today's worker mapping. luna, leo, orion
// complete 3F/3M — no provider description exists: TO CONFIRM BY EAR.
const GROK_REC: Record<VoiceGender, string[]> = { f: ["eve", "ara", "luna"], m: ["rex", "leo", "orion"] };

const rank = (rec: Record<VoiceGender, string[]>, g: VoiceGender, name: string) => {
  const i = rec[g].indexOf(name);
  return i < 0 ? null : ((i + 1) as 1 | 2 | 3);
};

export const VOICE_CATALOGUE: readonly CatalogueVoice[] = [
  ...OPENAI_ORDER.map((name, i) => ({
    id: `voice-${101 + i}`, engine: "openai" as const, name, gender: VOICE_GENDER[name], descriptor: null,
    recommendedRank: rank(OPENAI_REC, VOICE_GENDER[name], name),
    available: PROVIDERS.openai.voices.includes(name),
  })),
  ...GEMINI.map(([name, gender, descriptor], i) => ({
    id: `voice-${201 + i}`, engine: "gemini" as const, name, gender, descriptor, recommendedRank: rank(GEMINI_REC, gender, name), available: true,
  })),
  ...GROK.map(([name, gender], i) => ({
    id: `voice-${301 + i}`, engine: "xai" as const, name, gender, descriptor: null, recommendedRank: rank(GROK_REC, gender, name), available: true,
  })),
];

const BY_ID = new Map(VOICE_CATALOGUE.map((v) => [v.id, v]));

export function catalogueVoice(id: string): CatalogueVoice | null {
  return BY_ID.get(id) ?? null;
}

export function engineVoices(engine: RealtimeProvider): CatalogueVoice[] {
  return VOICE_CATALOGUE.filter((v) => v.engine === engine);
}

/** The engine's 6 recommended voices, interleaved F/M by rank (F1, M1, F2, M2, F3, M3). */
export function recommendedVoices(engine: RealtimeProvider): CatalogueVoice[] {
  const r = engineVoices(engine).filter((v) => v.recommendedRank);
  const at = (g: VoiceGender, k: number) => r.find((v) => v.gender === g && v.recommendedRank === k)!;
  return [1, 2, 3].flatMap((k) => [at("f", k), at("m", k)]);
}

/** Our id for an engine's real voice name (OpenAI names: what legacy columns hold). */
export function catalogueIdFor(engine: RealtimeProvider, name: string): string | null {
  const n = engine === "xai" ? name.trim().toLowerCase() : name.trim();
  return VOICE_CATALOGUE.find((v) => v.engine === engine && v.name === n)?.id ?? null;
}

/**
 * The equivalent voice on another engine, so a choice follows the customer
 * when the admin changes engine: SAME GENDER always; a recommended voice →
 * the target's recommended voice of the same rank; any other voice → the
 * target's other voices of that gender in order (cycling only when the
 * target has fewer), so distinct choices stay distinct wherever the target
 * has room. Character can't be matched from data: only Gemini documents it.
 */
export function equivalentVoice(id: string, target: RealtimeProvider): CatalogueVoice | null {
  const src = catalogueVoice(id);
  if (!src) return null;
  if (src.engine === target) return src;
  const pool = engineVoices(target).filter((v) => v.gender === src.gender && v.available);
  if (src.recommendedRank) return pool.find((v) => v.recommendedRank === src.recommendedRank) ?? null;
  const others = pool.filter((v) => !v.recommendedRank);
  const srcOthers = engineVoices(src.engine).filter((v) => v.gender === src.gender && !v.recommendedRank);
  const i = srcOthers.findIndex((v) => v.id === src.id);
  return others.length ? others[i % others.length] : pool[0] ?? null;
}

/** The whole equivalence table: our id → its voice on each engine. */
export function equivalenceTable(): Record<string, Record<RealtimeProvider, string>> {
  const out: Record<string, Record<RealtimeProvider, string>> = {};
  for (const v of VOICE_CATALOGUE) {
    out[v.id] = {
      openai: equivalentVoice(v.id, "openai")!.id,
      gemini: equivalentVoice(v.id, "gemini")!.id,
      xai: equivalentVoice(v.id, "xai")!.id,
    };
  }
  return out;
}
