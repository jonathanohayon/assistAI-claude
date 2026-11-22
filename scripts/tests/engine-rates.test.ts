// Per-engine / per-model per-minute rates in the Finance rate card
// (lib/finance/rates.ts perMinuteUsd, GET/PUT /api/admin/cost-rates): the
// defaults (xAI 0.08 from the worker's pricing; OpenAI / Gemini absent, never
// invented), the historic keys BYTE-IDENTICAL, the strict parser, the PUT
// helper fed the RAW body (four gate cases) and the lookup. Mock data only.
// Run with:  npx tsx scripts/tests/engine-rates.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_COST_RATES,
  DEFAULT_PER_MINUTE_USD,
  costRatesWrite,
  normalizeCostRates,
  parsePerMinuteUsd,
  perMinuteUsdFor,
  type CostRates,
} from "../../lib/finance/rates";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const clone = <T>(x: T): T => structuredClone(x);

// The historic rate card, byte for byte, as GET served it before E1.
const LEGACY_JSON =
  '{"openaiUsdPerMinute":0.3,"openaiUsdPerInputToken":0.00004,"openaiUsdPerOutputToken":0.00008,' +
  '"openaiUsdPerCachedInputToken":4e-7,"twilioInboundUsdPerMinute":0.0085,"twilioOutboundUsdPerMinute":0.14,' +
  '"twilioNumberUsdPerMonth":1.15,"transferAvgMinutes":3,"whatsappUsdPerMessage":0.02,"infraUsdPerMonth":0,' +
  '"eurToUsd":1.08,"ilsToUsd":0.27}';
const withoutPerMinute = (r: CostRates) => {
  const { perMinuteUsd: _p, ...rest } = r;
  void _p;
  return rest;
};

// ── Defaults ──────────────────────────────────────────────────────────────
assert.deepEqual(DEFAULT_PER_MINUTE_USD, { openai: {}, gemini: {}, xai: { "*": 0.08 } });
// xAI matches the worker's pricing (src/pricing.ts XAI_USD_PER_MINUTE = 0.08).
assert.equal(DEFAULT_COST_RATES.perMinuteUsd.xai["*"], 0.08);
console.log("ok: defaults (xai 0.08; openai / gemini absent)");

// ── Historic keys byte-identical, perMinuteUsd additive and last ─────────
{
  const r = normalizeCostRates({});
  const json = JSON.stringify(r);
  assert.equal(JSON.stringify(withoutPerMinute(r)), LEGACY_JSON, "defaults: historic keys byte-identical");
  assert.equal(json, LEGACY_JSON.slice(0, -1) + ',"perMinuteUsd":{"openai":{},"gemini":{},"xai":{"*":0.08}}}', "perMinuteUsd appended last");
  // A stored row written before E1 (no perMinuteUsd) reads back identical + the defaults.
  const legacyStored = { ...JSON.parse(LEGACY_JSON), twilioInboundUsdPerMinute: 0.01, eurToUsd: 1.1 };
  const back = normalizeCostRates(legacyStored);
  assert.equal(JSON.stringify(withoutPerMinute(back)), JSON.stringify(legacyStored), "custom historic values byte-identical");
  assert.deepEqual(back.perMinuteUsd, DEFAULT_PER_MINUTE_USD);
  // The historic coercions are unchanged (finance-transfer.test.ts pins some too).
  assert.equal(normalizeCostRates({ openaiUsdPerMinute: "0.5" }).openaiUsdPerMinute, 0.5);
  assert.equal(normalizeCostRates({ openaiUsdPerMinute: -1 }).openaiUsdPerMinute, 0.3);
  assert.equal(JSON.stringify(withoutPerMinute(normalizeCostRates(null))), LEGACY_JSON);
  // A stored perMinuteUsd round-trips; an invalid one falls back to the defaults.
  const custom = { openai: { "gpt-realtime-2.1": 0.25 }, gemini: { "*": 0.05 }, xai: { "*": 0.08 } };
  assert.deepEqual(normalizeCostRates({ perMinuteUsd: custom }).perMinuteUsd, custom);
  assert.deepEqual(normalizeCostRates({ perMinuteUsd: { xai: { "*": -1 } } }).perMinuteUsd, DEFAULT_PER_MINUTE_USD);
  // The defaults object is never handed out by reference.
  normalizeCostRates({}).perMinuteUsd.xai["*"] = 9;
  assert.equal(DEFAULT_PER_MINUTE_USD.xai["*"], 0.08);
}
console.log("ok: historic keys byte-identical, perMinuteUsd additive");

// ── Strict parser ─────────────────────────────────────────────────────────
assert.deepEqual(parsePerMinuteUsd(clone(DEFAULT_PER_MINUTE_USD)), DEFAULT_PER_MINUTE_USD);
for (const [name, bad] of [
  ["missing engine", { openai: {}, gemini: {} }],
  ["unknown engine", { openai: {}, gemini: {}, xai: {}, mistral: {} }],
  ["engine array", { openai: [], gemini: {}, xai: {} }],
  ["negative", { openai: {}, gemini: {}, xai: { "*": -0.1 } }],
  ["NaN", { openai: {}, gemini: {}, xai: { "*": NaN } }],
  ["string amount", { openai: {}, gemini: {}, xai: { "*": "0.08" } }],
  ["null amount", { openai: {}, gemini: {}, xai: { "*": null } }],
  ["bad model key", { openai: { "bad key!": 1 }, gemini: {}, xai: {} }],
] as Array<[string, unknown]>) {
  assert.equal(parsePerMinuteUsd(bad), null, `parse refuses: ${name}`);
}
for (const bad of [null, undefined, "x", 1, []]) assert.equal(parsePerMinuteUsd(bad), null);
console.log("ok: strict parser");

// ── PUT helper, fed the RAW body: the four gate cases ────────────────────
const stored: CostRates = normalizeCostRates({ twilioInboundUsdPerMinute: 0.01, perMinuteUsd: { openai: { "gpt-realtime-2.1": 0.25 }, gemini: {}, xai: { "*": 0.08 } } });
const formBody = (r: CostRates) => ({ rates: JSON.parse(JSON.stringify(r)) as unknown });
// Case 1 — other fields pass: the Finance form's save (historic keys) works as before.
{
  const edited = { ...withoutPerMinute(stored), twilioInboundUsdPerMinute: 0.02 };
  const w = costRatesWrite(stored, { rates: edited });
  assert.ok(w.ok && w.changed);
  assert.equal(w.ok && w.value.twilioInboundUsdPerMinute, 0.02);
  assert.deepEqual(w.ok && w.value.perMinuteUsd, stored.perMinuteUsd, "perMinuteUsd untouched by a historic-key save");
  // Both body shapes (`{ rates }` and the bare object) still work.
  const bare = costRatesWrite(stored, edited);
  assert.deepEqual(bare, w);
}
// Case 2 — an unchanged re-send (the form re-posting what GET served) passes, changed=false.
assert.deepEqual(costRatesWrite(stored, formBody(stored)), { ok: true, value: stored, changed: false });
// Case 3 — a perMinuteUsd change: valid → merged; invalid → every path named, nothing written.
{
  const w = costRatesWrite(stored, { rates: { ...withoutPerMinute(stored), perMinuteUsd: { gemini: { "*": 0.05 }, openai: { "gpt-realtime-2.1": null } } } });
  assert.ok(w.ok && w.changed);
  assert.deepEqual(w.ok && w.value.perMinuteUsd, { openai: {}, gemini: { "*": 0.05 }, xai: { "*": 0.08 } });
  assert.deepEqual(stored.perMinuteUsd.openai, { "gpt-realtime-2.1": 0.25 }, "the stored value is never mutated");
  assert.deepEqual(
    costRatesWrite(stored, { rates: { perMinuteUsd: { mistral: { "*": 1 }, xai: { "*": -1, "bad key!": 1 }, gemini: "x" } } }),
    { ok: false, error: "invalid_cost_rates", fields: ["perMinuteUsd.mistral", "perMinuteUsd.xai.*", "perMinuteUsd.xai.bad key!", "perMinuteUsd.gemini"] },
  );
  assert.deepEqual(costRatesWrite(stored, { rates: { perMinuteUsd: 3 } }), { ok: false, error: "invalid_cost_rates", fields: ["perMinuteUsd"] });
}
// Case 4 — OMITTED perMinuteUsd = the stored value (not the defaults).
for (const body of [{ rates: withoutPerMinute(stored) }, withoutPerMinute(stored), { rates: { ...withoutPerMinute(stored), perMinuteUsd: {} } }, { rates: { ...withoutPerMinute(stored), perMinuteUsd: { xai: {} } } }]) {
  const w = costRatesWrite(stored, body);
  assert.ok(w.ok, JSON.stringify(body).slice(0, 60));
  assert.deepEqual(w.ok && w.value.perMinuteUsd, stored.perMinuteUsd, "omitted = unchanged");
}
// KNOWN BUG cost-rates-partial-reset (pre-existing, unchanged by E1): an
// OMITTED historic key is reset to its DEFAULT, not kept, because the PUT
// normalises the body alone. The Finance form always posts every key, so it
// is latent. This asserts today's behaviour and must break when it is fixed.
{
  const w = costRatesWrite(stored, { rates: { eurToUsd: 1.2 } });
  assert.ok(w.ok);
  assert.equal(w.ok && w.value.twilioInboundUsdPerMinute, DEFAULT_COST_RATES.twilioInboundUsdPerMinute, "KNOWN BUG cost-rates-partial-reset: omitted historic key → default");
}
// Every accepted write normalises back to itself (what setCostRates stores).
{
  const w = costRatesWrite(stored, { rates: { ...withoutPerMinute(stored), perMinuteUsd: { gemini: { "gemini-3.8-live": 0.04 } } } });
  assert.ok(w.ok);
  assert.deepEqual(w.ok && normalizeCostRates(JSON.parse(JSON.stringify(w.value))), w.ok && w.value);
}
console.log("ok: PUT helper (4 gate cases + KNOWN BUG marker)");

// ── Lookup ────────────────────────────────────────────────────────────────
{
  const r = normalizeCostRates({ perMinuteUsd: { openai: { "gpt-realtime-2.1": 0.25 }, gemini: { "gemini-3.8-live": 0.04 }, xai: { "*": 0.08, "grok-voice-think-fast-1.0": 0.1 } } });
  const table: Array<[Parameters<typeof perMinuteUsdFor>[1], string | null, number | null]> = [
    ["xai", null, 0.08],
    ["xai", "grok-voice-3.0", 0.08],
    ["xai", "grok-voice-think-fast-1.0", 0.1],
    ["openai", "gpt-realtime-2.1", 0.25],
    ["openai", "gpt-realtime-2", 0.3], // no entry → the existing openaiUsdPerMinute estimate
    ["openai", null, 0.3],
    ["gemini", "gemini-3.8-live", 0.04],
    ["gemini", "gemini-other", null], // unknown, never guessed
  ];
  for (const [e, m, want] of table) assert.equal(perMinuteUsdFor(r, e, m), want, `perMinuteUsdFor(${e}, ${m})`);
  assert.equal(perMinuteUsdFor(DEFAULT_COST_RATES, "gemini", null), null, "Gemini has no default per-minute rate");
}
console.log("ok: perMinuteUsdFor lookup");

// ── Static guards on the route ────────────────────────────────────────────
const route = code("app/api/admin/cost-rates/route.ts");
for (const m of ["GET", "PUT"]) {
  const body = route.slice(route.indexOf(`export async function ${m}`));
  assert.match(body.slice(0, 200), /const guard = await requireAdmin\(\);\s*if \(!guard\.ok\) return guard\.response;/, `${m} is admin-only first`);
}
assert.match(route, /return NextResponse\.json\(\{ rates: await getCostRates\(\) \}\);/, "GET serves the normalised rate card as before");
assert.match(route, /costRatesWrite\(await getCostRates\(\), body\)/, "PUT goes through the raw-body helper");
assert.match(route, /if \(!w\.ok\) return NextResponse\.json\(\{ error: w\.error, fields: w\.fields \}, \{ status: 400 \}\);\s*await setCostRates\(w\.value\);/);

console.log("ALL ENGINE-RATES TESTS PASSED");
