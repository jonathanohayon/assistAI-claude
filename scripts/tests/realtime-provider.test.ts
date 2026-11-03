// Admin-only speech engine per tenant (lib/realtime-provider.ts).
// Run with:  npx tsx scripts/tests/realtime-provider.test.ts

import assert from "node:assert/strict";

import {
  ADMIN_ENGINE_OPTIONS,
  REALTIME_PROVIDER_MODEL,
  currentEngineOption,
  adminOnlyProviderUpdate,
  effectiveRealtimeProvider,
  parseRealtimeProvider,
  withoutAdminOnlyFields,
} from "../../lib/realtime-provider";

// admin writes: openai / null / empty store NULL (the default)
for (const v of [null, undefined, "", "openai", " OpenAI "]) {
  assert.deepEqual(parseRealtimeProvider(v), { ok: true, value: null });
}
assert.deepEqual(parseRealtimeProvider("gemini"), { ok: true, value: "gemini" });
assert.deepEqual(parseRealtimeProvider("XAI"), { ok: true, value: "xai" });
for (const v of ["grok", "anthropic", 3, {}, ["xai"]]) {
  assert.equal(parseRealtimeProvider(v).ok, false, `${JSON.stringify(v)} must be refused`);
}

// what the worker receives: NULL and unknown values fall back to openai
assert.equal(effectiveRealtimeProvider(null), "openai");
assert.equal(effectiveRealtimeProvider(undefined), "openai");
assert.equal(effectiveRealtimeProvider("something-old"), "openai");
assert.equal(effectiveRealtimeProvider("gemini"), "gemini");
assert.equal(effectiveRealtimeProvider("xai"), "xai");

// THE RULE: a tenant can never set it through /api/dashboard/config,
// even with a hand-crafted body, and gets no error that would reveal it
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "gemini" }, false), { update: {} });
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "not-a-provider" }, false), { update: {} });
assert.deepEqual(adminOnlyProviderUpdate({ voice: "marin" }, false), { update: {} });
// an admin on their own dashboard can
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "xai" }, true), { update: { realtimeProvider: "xai" } });
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "openai" }, true), { update: { realtimeProvider: null } });
assert.ok("error" in adminOnlyProviderUpdate({ realtimeProvider: "grok" }, true));
// an admin form that doesn't send the field changes nothing
assert.deepEqual(adminOnlyProviderUpdate({ voice: "marin" }, true), { update: {} });

// tenants never see the field when reading their config
const row = { voice: "marin", model: "gpt-realtime-2", realtimeProvider: "gemini" };
const visible = withoutAdminOnlyFields(row);
assert.equal("realtimeProvider" in visible, false);
assert.equal(visible.voice, "marin");

// display models (cited in lib/realtime-provider.ts)
assert.deepEqual(REALTIME_PROVIDER_MODEL, {
  openai: "gpt-realtime-2",
  gemini: "gemini-3.8-live",
  xai: "grok-voice-3.0",
});

// admin picker entries (labels agreed with tamaraAlbert / Jonathan)
assert.deepEqual(
  ADMIN_ENGINE_OPTIONS.map((o) => o.label),
  [
    "OpenAI gpt-realtime-2 (default)",
    "OpenAI gpt-realtime-2.1",
    "Gemini 3.8 Live (experimental)",
    "Grok Voice 3.0 (no Hebrew)",
  ],
);
// every entry's provider passes the admin validation
for (const o of ADMIN_ENGINE_OPTIONS) assert.equal(parseRealtimeProvider(o.realtimeProvider).ok, true);
// tenants as they are today map to the default entry
assert.equal(currentEngineOption({ realtimeProvider: null, model: "gpt-realtime-2" }), "openai-2");
assert.equal(currentEngineOption({}), "openai-2");
assert.equal(currentEngineOption({ realtimeProvider: null, model: "gpt-realtime-2.1" }), "openai-2.1");
assert.equal(currentEngineOption({ realtimeProvider: "gemini", model: "gpt-realtime-2.1" }), "gemini");
assert.equal(currentEngineOption({ realtimeProvider: "xai", model: "gpt-realtime-2" }), "xai");

console.log("ALL REALTIME-PROVIDER TESTS PASSED");
