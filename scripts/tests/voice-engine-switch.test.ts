// Unit tests for the V8e engine switch (lib/voice/choice.ts
// voiceAfterEngineSwitch + both write paths in lib/voice/route-writes.ts).
// Run with:  npx tsx scripts/tests/voice-engine-switch.test.ts
import assert from "node:assert/strict";

import { voicesFor } from "../../lib/realtime";
import { adminOnlyProviderUpdate } from "../../lib/realtime-provider";
import { engineVoices, equivalentVoice } from "../../lib/voice/catalogue";
import { effectiveEngineVoiceName, voiceAfterEngineSwitch } from "../../lib/voice/choice";
import { inboundLegacyVoiceUpdates, inboundVoiceConfigAfterLegacy, inboundVoiceConfigUpdates } from "../../lib/voice/route-writes";
import { currentInboundVoice } from "../../lib/voice/store";

type Engine = "openai" | "gemini" | "xai";
const row = (engine: Engine | null, voice = "ash", voiceProfile: unknown = null) => ({
  voice, model: "gpt-realtime-2", speed: 1, realtimeProvider: engine, voiceProfile, noiseReductionLevel: 8, voiceConfig: null as unknown,
});
const v = (r: ReturnType<typeof row>) => currentInboundVoice(r.voiceConfig, r);
const eff = (voice: ReturnType<typeof v>, e: Engine) => effectiveEngineVoiceName(voice, e);

// ── The switch itself ──────────────────────────────────────────────────
// OpenAI → Grok: ash follows to its equivalent (orion), not the gender fallback (rex).
const ashOnGrok = voiceAfterEngineSwitch(v(row(null)), "openai", "xai");
assert.equal(eff(ashOnGrok, "xai"), "orion");
assert.equal(eff(v(row("xai")), "xai"), "rex", "before V8e: the fallback");
assert.equal(ashOnGrok.voiceId, "ash", "the OpenAI column is untouched on a switch to Grok");
// Grok (orion) → Gemini → Puck; → OpenAI → ash, no OpenAI override.
const onGemini = voiceAfterEngineSwitch(ashOnGrok, "xai", "gemini");
assert.equal(eff(onGemini, "gemini"), "Puck");
assert.equal(onGemini.advanced.voiceOverrides.xai, "orion", "the old engine's override is kept (switching back restores it)");
const back = voiceAfterEngineSwitch(onGemini, "gemini", "openai");
assert.equal(back.voiceId, "ash");
assert.equal(back.advanced.voiceOverrides.openai, undefined);
// A Grok-only choice → OpenAI takes its equivalent in the voice column.
const leoOnGrok = voiceAfterEngineSwitch(v(row("xai", "marin", { voiceOverrides: { xai: "leo" } })), "xai", "openai");
assert.equal(leoOnGrok.voiceId, "ballad");
// Every available voice of every engine keeps its gender across a switch, and lands on an available voice.
for (const from of ["openai", "gemini", "xai"] as const) {
  for (const to of ["openai", "gemini", "xai"] as const) {
    for (const src of engineVoices(from).filter((x) => x.available)) {
      const t = equivalentVoice(src.id, to)!;
      assert.equal(t.gender, src.gender);
      assert.ok(t.available);
    }
  }
}
// Same engine = identity; a custom name outside the catalogue is left alone.
const same = v(row("xai"));
assert.equal(voiceAfterEngineSwitch(same, "xai", "xai"), same);
const custom = v(row("xai", "ash", { voiceOverrides: { xai: "my-cloned-voice" } }));
assert.deepEqual(voiceAfterEngineSwitch(custom, "xai", "gemini"), custom);

// ── 3 cases on the admin-only engine (voiceConfig path) ────────────────
const tenantSwitch = inboundVoiceConfigUpdates({ voiceConfig: { engine: "xai" } }, row(null), false, voicesFor);
assert.ok(tenantSwitch && "error" in tenantSwitch && tenantSwitch.error.status === 403 && tenantSwitch.error.body.fields?.includes("engine"), JSON.stringify(tenantSwitch));
const tenantSame = inboundVoiceConfigUpdates({ voiceConfig: { engine: "xai" } }, row("xai"), false, voicesFor);
assert.ok(tenantSame && "updates" in tenantSame, "re-sending the unchanged engine passes");
assert.equal(((tenantSame.updates.voiceProfile ?? {}) as { voiceOverrides?: object }).voiceOverrides && JSON.stringify((tenantSame.updates.voiceProfile as { voiceOverrides: object }).voiceOverrides), "{}", "…and writes no override");
const adminSwitch = inboundVoiceConfigUpdates({ voiceConfig: { engine: "xai" } }, row(null), true, voicesFor);
assert.ok(adminSwitch && "updates" in adminSwitch);
assert.equal(adminSwitch.updates.realtimeProvider, "xai");
assert.deepEqual((adminSwitch.updates.voiceProfile as { voiceOverrides: object }).voiceOverrides, { xai: "orion" });
// Switch + a voice chosen in the same save: the choice wins, on the new engine.
const both = inboundVoiceConfigUpdates({ voiceConfig: { engine: "gemini", voiceId: "voice-226" } }, row(null), true, voicesFor);
assert.ok(both && "updates" in both);
assert.deepEqual((both.updates.voiceProfile as { voiceOverrides: object }).voiceOverrides, { gemini: "Sulafat" });

// ── Legacy `realtimeProvider` field (admin only; tenants are ignored) ───
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "xai" }, false), { update: {} }, "a tenant's engine field is ignored");
// No engine change → exactly the legacy behaviour.
for (const updates of [{}, { speed: 1.1 }, { realtimeProvider: "xai" as const }]) {
  const r = row("xai");
  assert.deepEqual(inboundLegacyVoiceUpdates(r, updates), { voiceConfig: inboundVoiceConfigAfterLegacy(r, updates) }, JSON.stringify(updates));
}
// Engine change → the voice follows.
const legacy = inboundLegacyVoiceUpdates(row(null), { realtimeProvider: "xai" });
assert.equal(legacy.voice, "ash");
assert.deepEqual((legacy.voiceProfile as { voiceOverrides: object }).voiceOverrides, { xai: "orion" });
const legacyBack = inboundLegacyVoiceUpdates(row("xai", "marin", { voiceOverrides: { xai: "leo" } }), { realtimeProvider: null });
assert.equal(legacyBack.voice, "ballad");

console.log("ALL VOICE-ENGINE-SWITCH TESTS PASSED");
