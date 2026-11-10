// Voice samples (V7): lib/voice/samples.ts + the renderer change. No real
// audio and no API call here. Run with:  npx tsx scripts/tests/voice-samples.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderSessionUpdate } from "../../lib/greeting-render";
import {
  parseSampleKey,
  pcmToWav,
  RECOMMENDED_VOICE_IDS,
  SAMPLE_TEXT,
  sampleRendering,
  samplePlan,
  sampleUrl,
  sampleVisible,
} from "../../lib/voice/samples";
import { VOICE_STYLE_PRESETS } from "../../lib/voice/contract";

// The opener's session.update is byte-identical to before (no tone/speed).
assert.deepEqual(renderSessionUpdate({ text: "x", voice: "marin", model: "gpt-realtime-2" }), {
  type: "session.update",
  session: {
    type: "realtime",
    output_modalities: ["audio"],
    audio: { output: { voice: "marin", format: { type: "audio/pcm", rate: 24000 } } },
    instructions:
      "Tu lis À VOIX HAUTE, mot pour mot, exactement le texte que l'utilisateur te donne. N'ajoute rien, ne reformule pas, ne commente pas.",
  },
});
// a styled sample carries the tone and speed
{
  const u = renderSessionUpdate({ text: "x", voice: "cedar", model: "m", tone: "Calm.", speed: 0.92 }) as {
    session: { audio: { output: { speed?: number } }; instructions: string };
  };
  assert.equal(u.session.audio.output.speed, 0.92);
  assert.match(u.session.instructions, /Ton : Calm\.$/);
}

// 3 voices × 4 styles × 3 languages, stable order, no duplicates
const plan = samplePlan();
assert.equal(plan.length, 36);
assert.equal(new Set(plan.map((k) => `${k.voiceId}/${k.style}/${k.language}`)).size, 36);
assert.deepEqual([...RECOMMENDED_VOICE_IDS], ["marin", "cedar", "coral"]);

// each sample is read with its style's tuning; warm = plain reading
assert.deepEqual(sampleRendering({ voiceId: "marin", style: "warm", language: "fr" }), { text: SAMPLE_TEXT.fr });
assert.deepEqual(sampleRendering({ voiceId: "marin", style: "calm", language: "en" }), {
  text: SAMPLE_TEXT.en,
  tone: VOICE_STYLE_PRESETS.calm.openai.instruction,
  speed: 0.92,
});

// customer-facing URLs + JSON: no supplier name
for (const k of plan) {
  const json = JSON.stringify({ ...k, url: sampleUrl(k) });
  assert.doesNotMatch(json, /openai|gpt|gemini|google|grok|xai|elevenlabs/i, json);
}
assert.equal(sampleUrl({ voiceId: "cedar", style: "warm", language: "he" }), "/api/voice/samples/cedar/warm/he");

// tenants hear warm only until the styles are heard (V6 gate); admins all
assert.equal(sampleVisible({ style: "warm" }, false), true);
for (const s of ["professional", "dynamic", "calm"] as const) {
  assert.equal(sampleVisible({ style: s }, false), false, s);
  assert.equal(sampleVisible({ style: s }, true), true, s);
}

// URL parsing: only known keys
assert.deepEqual(parseSampleKey("coral", "dynamic", "en"), { voiceId: "coral", style: "dynamic", language: "en" });
assert.equal(parseSampleKey("ash", "warm", "fr"), null, "not a recommended voice");
assert.equal(parseSampleKey("marin", "loud", "fr"), null);
assert.equal(parseSampleKey("marin", "warm", "de"), null);
assert.equal(parseSampleKey("../x", "warm", "fr"), null);

// gender-neutral sample text in all 3 languages
assert.doesNotMatch(SAMPLE_TEXT.fr, /\b(assistante?|ravie?|prête?)\b/i);
assert.ok(SAMPLE_TEXT.he.length > 10 && SAMPLE_TEXT.en.length > 10);

// WAV header
{
  const wav = pcmToWav(new Uint8Array([1, 0, 2, 0]), 24000);
  assert.equal(wav.length, 48);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  const v = new DataView(wav.buffer);
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(40, true), 4);
}

// migration: idempotent table
const sql = readFileSync(new URL("../../drizzle/0042_voice_samples.sql", import.meta.url), "utf8");
assert.match(sql, /CREATE TABLE IF NOT EXISTS "voice_samples"/);
assert.match(sql, /UNIQUE\("voice_id","style","language","version"\)/);

console.log("ALL VOICE-SAMPLES TESTS PASSED");
