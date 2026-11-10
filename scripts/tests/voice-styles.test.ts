// Voice styles (V6): lib/voice/contract.ts VOICE_STYLE_PRESETS, applied by
// toEngineSettings. "warm" MUST equal today's behaviour exactly; the other
// styles must differ from warm and from each other on every engine, and stay
// hidden from tenants until Jonathan has listened. Mock data only.
// Run with:  npx tsx scripts/tests/voice-styles.test.ts

import assert from "node:assert/strict";

import { fromInboundColumns, fromOutboundColumns } from "../../lib/voice/adapters";
import {
  DEFAULT_VOICE,
  STYLE_SELECTOR_TENANT_VISIBLE,
  VOICE_STYLE_PRESETS,
  VOICE_STYLES,
  type Voice,
} from "../../lib/voice/contract";
import { toEngineSettings } from "../../lib/voice/engine";
import { inboundColumnsFromVoice } from "../../lib/voice/store";
import { effectiveRealtimeProvider } from "../../lib/realtime-provider";
import { effectiveVoiceProfile } from "../../lib/voice-profile";

const ENGINES = ["auto", "openai", "gemini", "xai"] as const;
const ctx = { defaultModel: "gpt-realtime-2" };
const withStyle = (v: Voice, style: Voice["style"], engine: Voice["engine"] = v.engine): Voice => ({ ...v, style, engine });

// warm is empty on every engine
for (const e of ["openai", "gemini", "xai"] as const) {
  assert.deepEqual(VOICE_STYLE_PRESETS.warm[e], { instruction: "", speedFactor: 1 }, `warm/${e}`);
}

// warm = today, exactly, including odd tenant speaking-style text
const rows = [
  { voice: "marin", model: "gpt-realtime-2", speed: 1, realtimeProvider: null, voiceProfile: null, noiseReductionLevel: 8 },
  { voice: "cedar", model: "gpt-realtime-2.1", speed: 1.13, realtimeProvider: "xai", noiseReductionLevel: 6, voiceProfile: { speakingStyle: "  ", pace: "fast" } },
  { voice: "sage", model: "gpt-realtime-2", speed: 0.9, realtimeProvider: "gemini", noiseReductionLevel: 10, voiceProfile: { speakingStyle: "Brief, mock salon tone." } },
];
for (const row of rows) {
  const v = fromInboundColumns(row);
  assert.equal(v.style, "warm");
  assert.deepEqual(toEngineSettings(v, ctx), {
    realtimeProvider: effectiveRealtimeProvider(row.realtimeProvider),
    model: row.model,
    voice: row.voice,
    speed: row.speed,
    noiseReductionLevel: row.noiseReductionLevel,
    voiceProfile: effectiveVoiceProfile(row.voiceProfile),
  });
}
assert.equal(toEngineSettings(fromOutboundColumns({ voice: "echo", personality: { vitesse: 7 }, noiseReductionLevel: 5 }), ctx).speed, 1.167);

// every other style differs from warm and from the others, on every engine
for (const engine of ENGINES) {
  const out = VOICE_STYLES.map((style) => JSON.stringify(toEngineSettings(withStyle(DEFAULT_VOICE, style, engine), ctx)));
  assert.equal(new Set(out).size, VOICE_STYLES.length, `styles distinct on ${engine}`);
}

// how each style shows up per engine
{
  const oa = (style: Voice["style"]) => toEngineSettings(withStyle(DEFAULT_VOICE, style, "openai"), ctx);
  assert.equal(oa("dynamic").speed, 1.08);
  assert.equal(oa("calm").speed, 0.92);
  assert.equal(oa("professional").speed, 1);
  assert.match(oa("professional").voiceProfile.speakingStyle, /businesslike/);
  // Gemini/Grok have no speed setting: pace goes in words, speed untouched
  for (const e of ["gemini", "xai"] as const) {
    const s = toEngineSettings(withStyle(DEFAULT_VOICE, "dynamic", e), ctx);
    assert.equal(s.speed, 1, e);
    assert.match(s.voiceProfile.speakingStyle, /brisk pace/, e);
    assert.match(toEngineSettings(withStyle(DEFAULT_VOICE, "calm", e), ctx).voiceProfile.speakingStyle, /Speak slowly/, e);
  }
  // a style multiplies a custom speed and keeps the tenant's own style line
  const custom: Voice = { ...DEFAULT_VOICE, style: "calm", advanced: { ...DEFAULT_VOICE.advanced, speed: 1.1, speakingStyle: "Mock line." } };
  const c = toEngineSettings(custom, ctx);
  assert.equal(c.speed, 1.012);
  assert.equal(c.voiceProfile.speakingStyle, `${VOICE_STYLE_PRESETS.calm.openai.instruction} Mock line.`);
  // the combined line stays within the profile's 300-char limit
  for (const style of VOICE_STYLES) for (const e of ["openai", "gemini", "xai"] as const) {
    assert.ok(VOICE_STYLE_PRESETS[style][e].instruction.length <= 150, `${style}/${e} preset short enough`);
  }
}

// the legacy columns hold base values: a styled voice round-trips without
// the style being applied twice (it's applied once, when served)
{

  const calm: Voice = { ...DEFAULT_VOICE, style: "calm", advanced: { ...DEFAULT_VOICE.advanced, speed: 1.1, model: "gpt-realtime-2" } };
  const cols = inboundColumnsFromVoice(calm, "gpt-realtime-2");
  assert.equal(cols.speed, 1.1, "base speed stored, not 1.012");
  assert.equal(cols.voiceProfile.speakingStyle, "", "preset text not stored");
  assert.deepEqual({ ...fromInboundColumns(cols), style: "calm" }, calm);
  assert.equal(toEngineSettings({ ...fromInboundColumns(cols), style: "calm" }, ctx).speed, 1.012, "styled once when served");
}

// gated until Jonathan has listened
assert.equal(STYLE_SELECTOR_TENANT_VISIBLE, false);

console.log("ALL VOICE-STYLES TESTS PASSED");
