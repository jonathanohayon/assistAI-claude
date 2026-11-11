// Text-to-speech on Gemini and Grok, for voice SAMPLES only (V8c): a
// customer on those engines hears the voice the calls really use. SERVER-ONLY
// (provider names + keys). Both return raw 16-bit LE PCM, 24 kHz, mono — the
// format of every stored sample. Verified 11/11/2026 against the live APIs.
//   Gemini: POST https://generativelanguage.googleapis.com/v1beta/interactions
//     (https://aistudio.google.com/docs/speech-generation), x-goog-api-key.
//   Grok:   POST https://api.x.ai/v1/tts
//     (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech), Bearer.

export interface Pcm {
  pcm: Buffer;
  sampleRate: number;
}

const SAMPLE_RATE = 24000;
const TIMEOUT_MS = 60_000;

export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";

export async function renderGeminiTts(text: string, voice: string, fetchImpl: typeof fetch = fetch): Promise<Pcm> {
  const key = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_API_KEY missing");
  const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      // The text is read verbatim (the language is detected from it).
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }>;
  } | null;
  if (!res.ok) throw new Error(`gemini tts ${res.status}: ${body?.error?.message?.slice(0, 160) ?? ""}`);
  const audio = (body?.steps ?? [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "audio" && c.data)
    .at(-1);
  if (!audio?.data) throw new Error("gemini tts: no audio in the response");
  return { pcm: Buffer.from(audio.data, "base64"), sampleRate: SAMPLE_RATE };
}

/** xAI's documented TTS languages that we sample in (no Hebrew: not supported). */
export const GROK_TTS_LANGUAGES = ["fr", "en"] as const;

export async function renderGrokTts(text: string, voice: string, language: string, fetchImpl: typeof fetch = fetch): Promise<Pcm> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY missing");
  const res = await fetchImpl("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text, voice_id: voice, language, output_format: { codec: "pcm", sample_rate: SAMPLE_RATE } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`grok tts ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  if (!pcm.length) throw new Error("grok tts: empty audio");
  return { pcm, sampleRate: SAMPLE_RATE };
}
