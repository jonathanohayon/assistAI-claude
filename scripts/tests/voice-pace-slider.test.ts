// Voice brick V9b: the pace slider. Mock data only.
// Run with:  npx tsx scripts/tests/voice-pace-slider.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CLIENT_DEFAULT_VOICE, VOICE_PACES, mergeClientVoice, type ClientVoice } from "../../components/bricks/voice/voice-client";
import { PACE_SPEED, paceNotch, paceResettable } from "../../components/bricks/voice/voice-ui";
import { outboundVoiceConfigUpdates } from "../../lib/voice/route-writes";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const voice = (pace: string, speed: number | null): ClientVoice =>
  ({ ...CLIENT_DEFAULT_VOICE, pace, advanced: { ...CLIENT_DEFAULT_VOICE.advanced, speed } }) as ClientVoice;

// 1. Five notches, slowest → fastest, Normal in the centre
{
  assert.deepEqual([...VOICE_PACES], ["very_slow", "slow", "normal", "fast", "very_fast"]);
  assert.equal(VOICE_PACES.indexOf("normal"), 2);
  const speeds = VOICE_PACES.map((p) => PACE_SPEED[p]);
  assert.ok(speeds.every((s, i) => i === 0 || s > speeds[i - 1]), "speeds increase");
}

// 2. Where the slider sits; a legacy custom speed → nearest notch, "Custom"
{
  assert.deepEqual(paceNotch(voice("fast", null)), { index: 3, custom: false });
  assert.deepEqual(paceNotch(voice("normal", 1.13)), { index: 3, custom: true }, "1.13 is nearest Fast (1.15)");
  assert.deepEqual(paceNotch(voice("normal", 0.5)), { index: 0, custom: true });
  assert.deepEqual(paceNotch(voice("normal", 2)), { index: 4, custom: true });
}

// 3. Reset only off plain Normal; touching the slider or Reset clears a custom speed
{
  assert.equal(paceResettable(voice("normal", null)), false);
  assert.equal(paceResettable(voice("slow", null)), true);
  assert.equal(paceResettable(voice("normal", 1.13)), true, "custom on the Normal notch can be reset");
  const r = mergeClientVoice(voice("normal", 1.13), { pace: "normal" });
  assert.ok(r.ok && r.value.advanced.speed === null && r.value.pace === "normal");
  const slider = read("components/bricks/voice/VoiceBrick.tsx");
  assert.match(slider, /onPointerUp=\{touch\}/);
  assert.match(slider, /onKeyUp=\{touch\}/);
  assert.match(slider, /if \(custom\) commit\(Number\(e\.currentTarget\.value\)\)/);
}

// 4. Words, never a number; no chips; level 1; native range (RTL mirrors it)
{
  const src = read("components/bricks/voice/VoiceBrick.tsx");
  assert.match(src, /aria-valuetext=\{words\}/);
  assert.doesNotMatch(src, /label=\{t\("paceLabel"\)\}\s*options=/, "the pace chips are gone");
  assert.ok(src.indexOf("{showPace && <PaceSlider") < src.indexOf("      <MoreSettings>"), "pace is level 1");
  assert.match(src, /type="range"\s*min=\{0\}\s*max=\{PACES\.length - 1\}/);
  for (const l of ["fr", "en", "he"]) {
    const vb = JSON.parse(read(`messages/${l}.json`)).VoiceBrick;
    for (const p of [...VOICE_PACES, "custom"]) assert.ok(vb.pace[p] && !/\d/.test(vb.pace[p]), `${l} pace.${p} in words`);
    assert.ok(vb.paceReset && vb.advanced.speed && vb.advancedHint.speed && vb.speedFollowsPace, l);
  }
}

// 5. Receptionist only; outbound shows no pace control (its call doesn't read `pace`)
{
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /<VoiceBrick[\s\S]*?\bshowPace\b[\s\S]*?\/>/);
  assert.doesNotMatch(read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx"), /showPace/);
  assert.match(read("components/bricks/voice/VoiceBrick.tsx"), /showPace = false/);
}

// 6. Outbound: saving another field keeps the legacy speed EXACTLY (every slider step, with or without a stored voice)
{
  for (const stored of [false, true])
    for (let vitesse = 1; vitesse <= 10; vitesse++) {
      const row = { voice: "marin", personality: { vitesse }, noiseReductionLevel: 5, voiceConfig: null as unknown };
      const save = (body: Record<string, unknown>) => {
        const r = outboundVoiceConfigUpdates(body, row, false);
        assert.ok(r && "updates" in r, "the save is accepted");
        return r;
      };
      if (stored) row.voiceConfig = save({ voiceConfig: { noiseReduction: 6 } }).voice;
      const personality = save({ voiceConfig: { bargeIn: false } }).updates.personality as { vitesse: number };
      assert.equal(personality.vitesse, vitesse, `stored=${stored} vitesse ${vitesse}`);
    }
}

console.log("ALL VOICE-PACE-SLIDER TESTS PASSED");
