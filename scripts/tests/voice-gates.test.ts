// Admin-only voice gates (tamaraVP's standing rule): a tenant changing a gated
// value → 403; a tenant saving OTHER fields while the gated value is already
// set by an admin → allowed, value untouched. Mock data only.
// Run with:  npx tsx scripts/tests/voice-gates.test.ts

import assert from "node:assert/strict";

import { DEFAULT_VOICE, STYLE_SELECTOR_TENANT_VISIBLE, type Voice } from "../../lib/voice/contract";
import { planVoiceWrite, VOICE_ADMIN_ONLY_PATHS } from "../../lib/voice/store";

assert.equal(STYLE_SELECTOR_TENANT_VISIBLE, false);

// an admin set every gated value
const adminSet: Voice = {
  ...DEFAULT_VOICE,
  engine: "xai",
  style: "calm",
  advanced: {
    ...DEFAULT_VOICE.advanced,
    model: "gpt-realtime-2.1",
    voiceOverrides: { xai: "rex" },
    openaiTurnMode: "semantic_vad",
    openaiEagerness: "low",
    openaiNoiseReduction: "far_field",
    openaiReasoning: "medium",
    grokReasoning: "none",
  },
};

// tenant saves OTHER fields (levels 1–2 and its own advanced fields) → OK, gated values untouched
for (const patch of [
  { patience: 4 },
  { pace: "slow", bargeIn: false, keyTerms: ["Mock"] },
  { noiseReduction: 6, languageLock: true },
  { advanced: { idleHangupSec: 45, fillers: false } },
  { voiceId: "cedar" },
  // the tenant's screen re-sending the gated values UNCHANGED is fine too
  { engine: "xai", style: "calm", advanced: { model: "gpt-realtime-2.1", grokReasoning: "none" } },
]) {
  const r = planVoiceWrite(adminSet, patch, false);
  assert.ok(r.ok, `tenant save ${JSON.stringify(patch)}`);
  assert.equal(r.voice.engine, "xai");
  assert.equal(r.voice.style, "calm");
  for (const p of VOICE_ADMIN_ONLY_PATHS.filter((x) => x.startsWith("advanced."))) {
    const k = p.slice("advanced.".length) as keyof Voice["advanced"];
    assert.deepEqual(r.voice.advanced[k], adminSet.advanced[k], `${p} untouched`);
  }
}

// tenant CHANGING a gated value → 403 admin_only, field named
for (const [patch, field] of [
  [{ engine: "openai" }, "engine"],
  [{ style: "warm" }, "style"],
  [{ style: "dynamic" }, "style"],
  [{ advanced: { model: "gpt-realtime-2" } }, "advanced.model"],
  [{ advanced: { grokReasoning: "high" } }, "advanced.grokReasoning"],
  [{ advanced: { voiceOverrides: {} } }, "advanced.voiceOverrides"],
] as const) {
  const r = planVoiceWrite(adminSet, patch, false);
  assert.ok(!r.ok && r.status === 403 && r.error === "admin_only" && r.fields?.includes(field), `${field}`);
}
// from the defaults: a tenant can't pick a non-warm style either
{
  const r = planVoiceWrite(DEFAULT_VOICE, { style: "professional" }, false);
  assert.ok(!r.ok && r.fields?.includes("style"));
}
// admins can change everything
assert.ok(planVoiceWrite(adminSet, { engine: "openai", style: "warm", advanced: { model: "gpt-realtime-2" } }, true).ok);

console.log("ALL VOICE-GATES TESTS PASSED");
