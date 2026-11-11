// Unit tests for lib/voice/choice.ts (V8b): a voice CHOSEN by our id is
// resolved server-side; voiceOverrides stays admin-only for direct writes.
// Run with:  npx tsx scripts/tests/voice-choice.test.ts
import assert from "node:assert/strict";

import { voicesFor } from "../../lib/realtime";
import { catalogueIdFor, engineVoices, equivalentVoice, recommendedVoices } from "../../lib/voice/catalogue";
import { effectiveEngineVoiceName, tenantVoiceChoice, voiceNumber } from "../../lib/voice/choice";
import { VOICE_ORDER } from "../../lib/voice/public";
import { inboundVoiceConfigUpdates } from "../../lib/voice/route-writes";
import { currentInboundVoice } from "../../lib/voice/store";

type Engine = "openai" | "gemini" | "xai";
const row = (engine: Engine | null, voice = "ash", voiceProfile: unknown = null) => ({
  voice, model: "gpt-realtime-2", speed: 1, realtimeProvider: engine, voiceProfile, noiseReductionLevel: 8, voiceConfig: null,
});
const save = (r: ReturnType<typeof row>, voiceConfig: unknown, isAdmin = false) =>
  inboundVoiceConfigUpdates({ voiceConfig }, r, isAdmin, voicesFor);
const overridesOf = (res: ReturnType<typeof save>) => {
  assert.ok(res && "updates" in res, JSON.stringify(res));
  return ((res.updates.voiceProfile ?? {}) as { voiceOverrides?: Record<string, string> }).voiceOverrides ?? {};
};
const grokId = (n: string) => catalogueIdFor("xai", n)!;

// ── 3 cases on the admin-only per-engine override ──────────────────────
// (1) a tenant's DIRECT write → 403 naming the field
const direct = save(row("xai"), { advanced: { voiceOverrides: { xai: "ara" } } });
assert.ok(direct && "error" in direct && direct.error.status === 403, JSON.stringify(direct));
assert.ok("error" in direct! && direct.error.body.fields?.includes("advanced.voiceOverrides"));
// (2) a tenant saving another field, or re-sending the unchanged overrides → passes
const admSet = row("xai", "ash", { voiceOverrides: { xai: "zagan" } });
assert.ok(save(admSet, { noiseReduction: 5 }) && "updates" in save(admSet, { noiseReduction: 5 })!);
assert.ok("updates" in save(admSet, { advanced: { voiceOverrides: { xai: "zagan" } } })!);
// (3) the SERVER-resolved write from our voice id passes, and sets the real voice
const chose = save(row("xai"), { voiceId: grokId("orion") });
assert.deepEqual(overridesOf(chose), { xai: "orion" });
assert.ok(chose && "updates" in chose && chose.updates.voice === "ash", "voice column = the OpenAI equivalent");
// an admin may still write the override directly
assert.deepEqual(overridesOf(save(row("xai"), { advanced: { voiceOverrides: { xai: "sal" } } }, true)), { xai: "sal" });

// ── An OpenAI tenant's voice save writes NO per-engine override at all ──
for (const engine of ["openai", null] as const) {
  for (const voiceId of ["cedar", catalogueIdFor("openai", "sage")!]) {
    const r = save(row(engine, "marin"), { voiceId });
    assert.deepEqual(overridesOf(r), {}, `${engine}: ${voiceId}`);
  }
}

// ── Grok: the 6 recommended choices give 6 distinct real voices (the defect) ──
const picked = recommendedVoices("xai").map((v) => overridesOf(save(row("xai", "marin"), { voiceId: v.id })).xai);
assert.equal(new Set(picked).size, 6, picked.join(","));
// Gemini too
const gem = recommendedVoices("gemini").map((v) => overridesOf(save(row("gemini", "marin"), { voiceId: v.id })).gemini);
assert.equal(new Set(gem).size, 6);
// A legacy OpenAI-name choice on Grok is resolved too (ash: rex by gender before → orion now).
assert.deepEqual(overridesOf(save(row("xai", "marin"), { voiceId: "ash" })), { xai: "orion" });
// Another engine's admin-set override is left alone.
assert.deepEqual(overridesOf(save(row("xai", "ash", { voiceOverrides: { gemini: "Puck", xai: "zagan" } }), { voiceId: grokId("leo") })), {
  gemini: "Puck", xai: "leo",
});

// ── Saves that choose nothing change nothing ───────────────────────────
// no voiceId in the patch
assert.deepEqual(overridesOf(save(row("xai"), { style: "warm" })), {});
// re-sending the voice the calls already use (ash on Grok = rex today, by gender)
const ashOnGrok = currentInboundVoice(null, row("xai"));
assert.equal(effectiveEngineVoiceName(ashOnGrok, "xai"), "rex");
const current = tenantVoiceChoice(ashOnGrok, "xai").current;
assert.equal(current, grokId("rex"), "today's effective Grok voice for ash");
const resend = save(row("xai"), { voiceId: current });
assert.deepEqual(overridesOf(resend), {}, "unchanged re-send writes nothing");
assert.ok(resend && "updates" in resend && resend.updates.voice === "ash", "our id never reaches the voice column");
// re-sending the same OpenAI name
assert.deepEqual(overridesOf(save(row("xai", "ash"), { voiceId: "ash" })), {});

// ── Tenant view: our ids, gender, recommended — no engine, no voice name ──
const view = tenantVoiceChoice(ashOnGrok, "xai");
assert.equal(view.options.length, 28);
for (const o of view.options) assert.deepEqual(Object.keys(o).sort(), ["gender", "id", "number", "recommended"]);
assert.equal(view.options.filter((o) => o.recommended).length, 6);
const json = JSON.stringify(view);
for (const leak of [/openai|gemini|grok|xai/i, /"(eve|rex|ara|orion|marin|ash|Sulafat)"/]) assert.doesNotMatch(json, leak);

// Every available voice of every engine can be chosen and SAVES (its OpenAI
// equivalent is in the realtime allow-list); unavailable ones are never offered.
for (const engine of ["xai", "gemini", "openai"] as const) {
  for (const v of engineVoices(engine).filter((x) => x.available)) {
    const r = save(row(engine, "marin"), { voiceId: v.id });
    assert.ok(r && "updates" in r, `${engine}/${v.name}: ${JSON.stringify(r)}`);
    if (engine !== "openai" && v.id !== catalogueIdFor(engine, effectiveEngineVoiceName(currentInboundVoice(null, row(engine, "marin")), engine))) {
      assert.equal(overridesOf(r)[engine], v.name, `${engine}/${v.name} is what the calls get`);
    }
  }
  assert.ok(tenantVoiceChoice(currentInboundVoice(null, row(engine)), engine).options.every((o) => engineVoices(engine).find((v) => v.id === o.id)?.available));
}
assert.equal(equivalentVoice(catalogueIdFor("xai", "carina")!, "openai")!.name !== "nova", true, "never an unavailable target");

console.log("ALL VOICE-CHOICE TESTS PASSED");

// ── V8c: numbers and samples in the tenant view ────────────────────────
{
  // PINNED: OpenAI customers keep today's "Voice N" (lib/use-voice-label order).
  assert.deepEqual([...VOICE_ORDER], ["marin", "cedar", "coral", "sage", "shimmer", "nova", "ballad", "verse", "alloy", "echo", "ash", "fable", "onyx"]);
  for (const v of engineVoices("openai")) assert.equal(voiceNumber(v), VOICE_ORDER.indexOf(v.name as never) + 1, v.name);
  for (const e of ["gemini", "xai"] as const) {
    const nums = engineVoices(e).map(voiceNumber);
    assert.deepEqual(nums, nums.map((_, i) => i + 1), `${e}: numbered 1..n in catalogue order`);
  }
  // Numbers are unique within the options shown.
  for (const e of ["openai", "gemini", "xai"] as const) {
    const opts = tenantVoiceChoice(currentInboundVoice(null, row(e)), e).options;
    assert.equal(new Set(opts.map((o) => o.number)).size, opts.length);
  }
  // A sample only when it IS the engine's real voice: the lookup only ever
  // sees that engine's catalogue voices (OpenAI by name, others by our id).
  const seen: string[] = [];
  const lookup = (v: { id: string; name: string; engine: string }) => {
    seen.push(v.engine);
    if (v.engine === "openai" && (v.name === "marin" || v.name === "cedar")) return `/api/voice/samples/${v.name}/warm/fr?v=1.0`;
    if (v.engine === "gemini" && v.name === "Sulafat") return `/api/voice/samples/${v.id}/warm/fr?v=1.0`;
    return null;
  };
  const oa = tenantVoiceChoice(currentInboundVoice(null, row("openai", "marin")), "openai", lookup);
  assert.equal(oa.options.find((o) => o.id === catalogueIdFor("openai", "marin"))!.sampleUrl, "/api/voice/samples/marin/warm/fr?v=1.0");
  assert.ok(!("sampleUrl" in oa.options.find((o) => o.id === catalogueIdFor("openai", "sage"))!), "no recorded sample → no key");
  assert.ok(!seen.some((e) => e !== "openai"));
  seen.length = 0;
  const gm = tenantVoiceChoice(currentInboundVoice(null, row("gemini", "marin")), "gemini", lookup);
  assert.ok(!seen.some((e) => e !== "gemini"), "a Gemini account never looks up an OpenAI recording");
  assert.deepEqual(gm.options.filter((o) => o.sampleUrl).map((o) => o.id), [catalogueIdFor("gemini", "Sulafat")]);
  assert.ok(!gm.options.some((o) => o.sampleUrl?.includes("marin")));
  const xa = tenantVoiceChoice(currentInboundVoice(null, row("xai", "marin")), "xai", lookup);
  assert.ok(xa.options.every((o) => !("sampleUrl" in o)), "no Grok recording yet → no Écouter");
  for (const o of oa.options) for (const k of Object.keys(o)) assert.ok(["id", "number", "gender", "recommended", "sampleUrl"].includes(k), k);
  console.log("ALL VOICE-CHOICE V8c TESTS PASSED");
}
