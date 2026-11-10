// Voice samples (V7): one short sample per recommended voice × style ×
// language, rendered on the default engine and stored in Postgres (never in
// git: they are regenerated from this file). CLIENT-SAFE, pure.
//
// Customer-facing URLs and JSON carry no supplier name: voice ids are the
// neutral voice names already used by the contract, styles and languages
// are ours.

import { STYLE_SELECTOR_TENANT_VISIBLE, VOICE_STYLES, VOICE_STYLE_PRESETS, type VoiceStyle } from "@/lib/voice/contract";

/** Voices offered first in the picker (they map to a dedicated voice on every engine). */
export const RECOMMENDED_VOICE_IDS = ["marin", "cedar", "coral"] as const;
export const SAMPLE_LANGUAGES = ["fr", "he", "en"] as const;
export type SampleLanguage = (typeof SAMPLE_LANGUAGES)[number];

/** Bump to re-render every sample (new text, new tuning). */
export const VOICE_SAMPLE_VERSION = 1;

/** Same sentence in each language; gender-neutral (male and female voices read it). */
export const SAMPLE_TEXT: Record<SampleLanguage, string> = {
  fr: "Bonjour et bienvenue ! Je peux vous proposer un rendez-vous mardi à dix heures. Est-ce que ça vous convient ?",
  he: "שלום וברוכים הבאים! אפשר להציע לכם תור ביום שלישי בשעה עשר. זה מתאים לכם?",
  en: "Hello and welcome! I can offer you an appointment on Tuesday at ten. Does that work for you?",
};

export interface SampleKey {
  voiceId: string;
  style: VoiceStyle;
  language: SampleLanguage;
}

/** Every sample to render, in a stable order. */
export function samplePlan(): SampleKey[] {
  const out: SampleKey[] = [];
  for (const voiceId of RECOMMENDED_VOICE_IDS)
    for (const style of VOICE_STYLES)
      for (const language of SAMPLE_LANGUAGES) out.push({ voiceId, style, language });
  return out;
}

/** How the default engine is asked to read it: the style's own tuning. */
export function sampleRendering(k: SampleKey): { text: string; tone?: string; speed?: number } {
  const p = VOICE_STYLE_PRESETS[k.style].openai;
  return {
    text: SAMPLE_TEXT[k.language],
    ...(p.instruction ? { tone: p.instruction } : {}),
    ...(p.speedFactor !== 1 ? { speed: p.speedFactor } : {}),
  };
}

export function sampleUrl(k: SampleKey): string {
  return `/api/voice/samples/${k.voiceId}/${k.style}/${k.language}`;
}

/** Tenants only hear the styles they can pick (just "warm" until V6 is heard). */
export function sampleVisible(k: Pick<SampleKey, "style">, isAdmin: boolean): boolean {
  return isAdmin || STYLE_SELECTOR_TENANT_VISIBLE || k.style === "warm";
}

export function parseSampleKey(voiceId: string, style: string, language: string): SampleKey | null {
  if (!(RECOMMENDED_VOICE_IDS as readonly string[]).includes(voiceId)) return null;
  if (!(VOICE_STYLES as readonly string[]).includes(style)) return null;
  if (!(SAMPLE_LANGUAGES as readonly string[]).includes(language)) return null;
  return { voiceId, style: style as VoiceStyle, language: language as SampleLanguage };
}

/** PCM16 mono → WAV (the browser plays it in an <audio> element). */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
