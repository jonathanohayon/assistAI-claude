// Samples of the Gemini and Grok voices (V8c), keyed by OUR catalogue id —
// the URL /api/voice/samples/<voice-2xx|3xx>/warm/<lang> names no engine.
// SERVER-ONLY. Only the recommended voices, only "warm" (the style tenants
// can pick until V6 is heard), Grok without Hebrew (unsupported by xAI).
import { catalogueVoice, recommendedVoices } from "@/lib/voice/catalogue";
import { GROK_TTS_LANGUAGES, renderGeminiTts, renderGrokTts, type Pcm } from "@/lib/voice/engine-tts";
import { SAMPLE_LANGUAGES, SAMPLE_TEXT, type SampleKey, type SampleLanguage } from "@/lib/voice/samples";

export type SampleEngine = "gemini" | "xai";

export function engineSamplePlan(engine: SampleEngine): SampleKey[] {
  const langs: readonly SampleLanguage[] = engine === "xai" ? GROK_TTS_LANGUAGES : SAMPLE_LANGUAGES;
  return recommendedVoices(engine).flatMap((v) => langs.map((language) => ({ voiceId: v.id, style: "warm" as const, language })));
}

/** A key of the engine plans, or null (the audio route then 404s). */
export function parseEngineSampleKey(voiceId: string, style: string, language: string): SampleKey | null {
  const v = catalogueVoice(voiceId);
  if (!v || (v.engine !== "gemini" && v.engine !== "xai")) return null;
  return engineSamplePlan(v.engine).find((k) => k.voiceId === voiceId && k.style === style && k.language === language) ?? null;
}

export async function renderEngineSample(k: SampleKey): Promise<Pcm> {
  const v = catalogueVoice(k.voiceId);
  if (!v) throw new Error(`unknown voice ${k.voiceId}`);
  const text = SAMPLE_TEXT[k.language];
  if (v.engine === "gemini") return renderGeminiTts(text, v.name);
  if (v.engine === "xai") return renderGrokTts(text, v.name, k.language);
  throw new Error(`no engine sample for ${k.voiceId}`);
}
