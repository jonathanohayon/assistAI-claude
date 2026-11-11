// An outbound agent's speed (the 1–10 "vitesse" slider) is written only by an
// explicit advanced.speed. Before: any pace save reset it to step 6.
// Run with:  npx tsx scripts/tests/outbound-keep-vitesse.test.ts
import assert from "node:assert/strict";

import { servedOutboundVoice } from "../../lib/voice/serve";
import { toEngineSettings } from "../../lib/voice/engine";
import { outboundVoiceConfigUpdates } from "../../lib/voice/route-writes";
import { clamp10, uiFromSpeed } from "../../lib/voice-tuning";

const row = (vitesse?: number) => ({
  voice: "marin",
  personality: vitesse === undefined ? {} : { vitesse, creativite: 3 },
  noiseReductionLevel: 8,
  voiceConfig: null as unknown,
});
const save = (r: ReturnType<typeof row>, voiceConfig: unknown) => {
  const w = outboundVoiceConfigUpdates({ voiceConfig }, r, false);
  assert.ok(w && "updates" in w, JSON.stringify(w));
  return w.updates as { personality: { vitesse?: number; creativite?: number }; voiceConfig: { advanced: { speed: number | null } } };
};
// What the call gets: the served speed from the columns (the outbound routes' path).
const servedSpeed = (r: { voice: string; personality: unknown; noiseReductionLevel: number }) =>
  toEngineSettings(servedOutboundVoice(r as never), { defaultModel: "gpt-realtime" }).speed;

for (let vitesse = 1; vitesse <= 10; vitesse++) {
  const r = row(vitesse);
  const before = servedSpeed(r);
  for (const [label, patch] of [
    ["pace save", { pace: "fast" }],
    ["other-field save", { noiseReduction: 5 }],
    ["two fields", { pace: "slow", patience: 4 }],
  ] as const) {
    const u = save(r, patch);
    assert.equal(u.personality.vitesse, vitesse, `vitesse ${vitesse}: ${label} keeps it`);
    assert.equal(u.personality.creativite, 3, "other personality keys kept");
    assert.equal(servedSpeed({ ...r, ...u, noiseReductionLevel: r.noiseReductionLevel }), before, `vitesse ${vitesse}: ${label} → same served speed`);
  }
}

// THE BUG (agent at 8, speed 1.278): "Fast" used to write vitesse 6 (1.056×).
assert.equal(save(row(8), { pace: "fast" }).personality.vitesse, 8);
// The stored voice keeps the custom speed too (the screen keeps "Custom").
assert.ok(save(row(8), { pace: "fast" }).voiceConfig.advanced.speed !== null);

// An explicit speed write still works.
assert.equal(save(row(8), { advanced: { speed: 1 } }).personality.vitesse, 6);
assert.equal(save(row(2), { advanced: { speed: 1.3 } }).personality.vitesse, clamp10(uiFromSpeed(1.3)));
assert.notEqual(clamp10(uiFromSpeed(1.3)), 2, "…and does change it");
// An agent without a stored vitesse keeps the same served speed on any save.
const fresh = row();
const fu = save(fresh, { pace: "fast" });
assert.equal(servedSpeed({ ...fresh, ...fu, noiseReductionLevel: 8 }), servedSpeed(fresh));

console.log("ALL OUTBOUND-KEEP-VITESSE TESTS PASSED");
