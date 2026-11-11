// Unit tests for the Gemini / Grok voice samples (V8c): plan, keys, renderers.
// Run with:  npx tsx scripts/tests/voice-engine-samples.test.ts
import assert from "node:assert/strict";

import { catalogueVoice, recommendedVoices } from "../../lib/voice/catalogue";
import { engineSamplePlan, parseEngineSampleKey } from "../../lib/voice/engine-samples";
import { GEMINI_TTS_MODEL, renderGeminiTts, renderGrokTts } from "../../lib/voice/engine-tts";
import { parseSampleKey, sampleUrl } from "../../lib/voice/samples";

// Plans: the 6 recommended voices, warm only; Grok without Hebrew.
const g = engineSamplePlan("gemini");
const x = engineSamplePlan("xai");
assert.equal(g.length, 18);
assert.equal(x.length, 12);
assert.ok([...g, ...x].every((k) => k.style === "warm"));
assert.ok(!x.some((k) => k.language === "he"), "xAI documents no Hebrew");
assert.deepEqual([...new Set(g.map((k) => k.voiceId))].sort(), recommendedVoices("gemini").map((v) => v.id).sort());
// Keys are OUR ids: the URL names no engine and no engine voice.
for (const k of [...g, ...x]) {
  assert.match(k.voiceId, /^voice-[23]\d\d$/);
  assert.doesNotMatch(sampleUrl(k), /gemini|grok|xai|openai|Sulafat|eve|orion/i);
}
// Parsing: engine keys parse, others don't; OpenAI keys still parse by name.
assert.deepEqual(parseEngineSampleKey(g[0].voiceId, "warm", "he"), { ...g[0], language: "he" });
assert.equal(parseEngineSampleKey(x[0].voiceId, "warm", "he"), null);
assert.equal(parseEngineSampleKey(g[0].voiceId, "calm", "fr"), null);
assert.equal(parseEngineSampleKey("voice-101", "warm", "fr"), null, "OpenAI voices are keyed by name");
assert.equal(parseEngineSampleKey("voice-999", "warm", "fr"), null);
assert.ok(parseSampleKey("marin", "warm", "fr"));

// Renderers: the documented request, raw PCM back.
async function main() {
  process.env.GOOGLE_API_KEY = "mock-google";
  process.env.XAI_API_KEY = "mock-xai";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gemini = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: Buffer.from([1, 2, 3, 4]).toString("base64") }] }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const v = catalogueVoice(g[0].voiceId)!;
  const a = await renderGeminiTts("Bonjour", v.name, gemini);
  assert.deepEqual([...a.pcm], [1, 2, 3, 4]);
  assert.equal(a.sampleRate, 24000);
  const gb = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "mock-google");
  assert.equal(gb.model, GEMINI_TTS_MODEL);
  assert.deepEqual(gb.response_format, { type: "audio", mime_type: "audio/l16", sample_rate: 24000 });
  assert.deepEqual(gb.generation_config, { speech_config: [{ voice: v.name }] });
  const grok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([9, 8, 7, 6]), { status: 200, headers: { "content-type": "audio/pcm" } });
  }) as unknown as typeof fetch;
  const b = await renderGrokTts("Bonjour", "orion", "fr", grok);
  assert.deepEqual([...b.pcm], [9, 8, 7, 6]);
  const xb = JSON.parse(String(calls[1].init.body));
  assert.equal(calls[1].url, "https://api.x.ai/v1/tts");
  assert.deepEqual(xb, { text: "Bonjour", voice_id: "orion", language: "fr", output_format: { codec: "pcm", sample_rate: 24000 } });
  // Errors surface (the generator records them and retries next call).
  const fail = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(renderGeminiTts("x", "Kore", fail), /gemini tts 429: quota/);
  await assert.rejects(renderGrokTts("x", "eve", "fr", (async () => new Response("", { status: 200 })) as unknown as typeof fetch), /empty audio/);
  delete process.env.XAI_API_KEY;
  await assert.rejects(renderGrokTts("x", "eve", "fr", grok), /XAI_API_KEY missing/);
  console.log("ALL VOICE-ENGINE-SAMPLES TESTS PASSED");
}
main().catch((e) => { console.error(e); process.exit(1); });
