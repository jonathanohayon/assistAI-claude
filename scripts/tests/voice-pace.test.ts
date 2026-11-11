// Unit tests for the 5-notch pace (V9a): today's 3 paces unchanged, the two
// ends folded into fields the live worker reads, the clamp respected.
// Run with:  npx tsx scripts/tests/voice-pace.test.ts
import assert from "node:assert/strict";

import { DEFAULT_VOICE, mergeVoice, VOICE_STYLES, type Voice } from "../../lib/voice/contract";
import { END_PACE_WORDS, toEngineSettings } from "../../lib/voice/engine";
import { inboundColumnsFromVoice } from "../../lib/voice/store";
import { fromInboundColumns } from "../../lib/voice/adapters";
import { PACE_SPEED, VOICE_PACES } from "../../lib/voice/public";

const WORKER_PACE_FACTOR = { slow: 0.9, normal: 1, fast: 1.15 } as const; // worker src/voice-profile.ts
const clamp = (s: number) => Math.min(1.5, Math.max(0.5, Math.round(s * 100) / 100)); // worker clampSpeed
const ctx = { defaultModel: "gpt-realtime-2" };
const voice = (pace: string, engine: Voice["engine"] = "auto", extra: Partial<Voice> = {}): Voice => {
  const m = mergeVoice({ ...DEFAULT_VOICE, engine, ...extra }, { pace });
  assert.ok(m.ok, JSON.stringify(m));
  return m.value;
};

// The order and today's values.
assert.deepEqual([...VOICE_PACES], ["very_slow", "slow", "normal", "fast", "very_fast"]);
for (const p of ["slow", "normal", "fast"] as const) assert.equal(PACE_SPEED[p], WORKER_PACE_FACTOR[p], `${p} keeps today's factor`);
const f = VOICE_PACES.map((p) => PACE_SPEED[p]);
assert.ok(f.every((x, i) => i === 0 || x > f[i - 1]), "factors increase very_slow → very_fast");

// slow / normal / fast: served exactly as before (pace as is, base speed, the worker applies the factor).
for (const p of ["slow", "normal", "fast"] as const) {
  for (const engine of ["auto", "gemini", "xai"] as const) {
    const e = toEngineSettings(voice(p, engine), ctx);
    assert.equal(e.voiceProfile.pace, p);
    assert.equal(e.speed, 1);
    assert.equal(e.voiceProfile.speakingStyle, "");
  }
}

// The two ends, OpenAI: served pace "normal" + the factor in the speed → the
// live worker produces exactly base × factor.
for (const p of ["very_slow", "very_fast"] as const) {
  const e = toEngineSettings(voice(p), ctx);
  assert.equal(e.voiceProfile.pace, "normal");
  assert.equal(clamp(e.speed * WORKER_PACE_FACTOR[e.voiceProfile.pace as "normal"]), PACE_SPEED[p]);
}
// …Gemini / Grok: pace "normal" + the stronger sentence first in the style line; speed untouched.
for (const engine of ["gemini", "xai"] as const) {
  for (const p of ["very_slow", "very_fast"] as const) {
    const e = toEngineSettings(voice(p, engine, { advanced: { ...DEFAULT_VOICE.advanced, speakingStyle: "Ton chaleureux." } }), ctx);
    assert.equal(e.voiceProfile.pace, "normal");
    assert.equal(e.voiceProfile.speakingStyle, `${END_PACE_WORDS[p]} Ton chaleureux.`);
    assert.equal(e.speed, 1);
  }
}

// The legacy columns keep the REAL pace (folded only when serving), and read back exactly.
for (const p of VOICE_PACES) {
  const cols = inboundColumnsFromVoice(voice(p), "gpt-realtime-2");
  assert.equal((cols.voiceProfile as { pace: string }).pace, p);
  assert.equal(cols.speed, 1, "base speed in the column");
  const back = fromInboundColumns({ ...cols, realtimeProvider: null });
  assert.equal(back.pace, p);
}

// Legacy custom speeds: kept exactly while untouched; any pace write clears them (the screen's "Custom").
for (const speed of [1.13, 0.87, 1.5]) {
  const v: Voice = { ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, speed } };
  assert.equal(toEngineSettings(v, ctx).speed, speed, `${speed} served exactly`);
  assert.equal(voice("very_fast", "auto", { advanced: v.advanced }).advanced.speed, null);
}

// The worst combinations stay inside the worker's 0.5–1.5 clamp (preset base speed, every style).
let lo = Infinity;
let hi = -Infinity;
for (const style of VOICE_STYLES) {
  for (const p of VOICE_PACES) {
    const e = toEngineSettings(voice(p, "auto", { style }), ctx);
    const finalSpeed = e.speed * WORKER_PACE_FACTOR[e.voiceProfile.pace as keyof typeof WORKER_PACE_FACTOR];
    lo = Math.min(lo, finalSpeed);
    hi = Math.max(hi, finalSpeed);
    assert.ok(finalSpeed >= 0.5 && finalSpeed <= 1.5, `${style} + ${p} = ${finalSpeed}`);
  }
}
assert.equal(Math.round(hi * 1000) / 1000, 1.404, "very_fast + dynamic");
assert.equal(Math.round(lo * 1000) / 1000, 0.736, "very_slow + calm");

console.log("ALL VOICE-PACE TESTS PASSED");
