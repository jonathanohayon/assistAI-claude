// The engine override per product (E2), pure parts:
//   1. engineForCall as a full table: path × override set/unset × client
//      set/unset × language supported/unsupported × honoured/not (+ the E2b
//      clientSalesOverride hook, null-only in E2);
//   2. the stored catalogue row: strict parse, byte-identical serialization
//      with no override, the admin write (set / clear / omitted = kept /
//      not honoured → refused, naming it);
//   3. voiceOnEngine: the voice follows through the equivalence table;
//   4. source guards: the handlers keep today's path when apply is false,
//      the public landing never imports the row module, the routes are
//      admin-only first.
// Mock data only. Run with:  npx tsx scripts/tests/engine-override.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_ENGINE_LANGUAGES, type EngineLanguages } from "../../lib/engine-languages";
import {
  engineForCall,
  engineOptionCoverage,
  engineOverrideProblems,
  noEngineOverrides,
  parseEngineOverride,
  productForPath,
  type CallPath,
  type EngineForCall,
  type EngineOverride,
  type EngineOverrides,
} from "../../lib/engine-override";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { catalogueRowWrite, parseCatalogueRow, serializeCatalogueRow } from "../../lib/product-catalogue-row";
import { PRODUCTS, type Product } from "../../lib/product-values";
import { REALTIME_PROVIDER_MODEL } from "../../lib/realtime-provider";
import { fromInboundColumns } from "../../lib/voice/adapters";
import { toEngineSettings } from "../../lib/voice/engine";
import { voiceOnEngine } from "../../lib/voice/override-voice";
import { servedInboundVoice } from "../../lib/voice/serve";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const G = REALTIME_PROVIDER_MODEL.gemini;
const X = REALTIME_PROVIDER_MODEL.xai;
const L: EngineLanguages = DEFAULT_ENGINE_LANGUAGES; // openai fr/en/he, gemini fr/en, xai fr/en

// ── 1. engineForCall: the table ─────────────────────────────────────────────
const NOT_SET = { realtimeProvider: null, model: "gpt-realtime-2" };
const SET_21 = { realtimeProvider: null, model: "gpt-realtime-2.1" };
const SET_XAI = { realtimeProvider: "xai", model: "gpt-realtime-2" };
const IN_TODAY = { engine: "openai" as const, model: "gpt-realtime-2" };
const OUT_TODAY = { engine: "openai" as const, model: "gpt-realtime" }; // the env model
const ov = (p: Product, o: EngineOverride | null): EngineOverrides => ({ ...noEngineOverrides(), [p]: o });

type Row = {
  name: string;
  path: CallPath;
  product: Product | null;
  client: { realtimeProvider: string | null; model: string } | null;
  override: EngineOverride | null;
  language: string;
  today: { engine: "openai" | "gemini" | "xai"; model: string };
  clientSalesOverride?: null;
  want: Partial<EngineForCall> & { apply: boolean };
};
const today = (t: Row["today"], source: "client" | "default") => ({ apply: false, engine: t.engine, model: t.engine === "openai" ? t.model : REALTIME_PROVIDER_MODEL[t.engine], servedModel: t.model, source });
const table: Row[] = [];
// Inbound, product reception and reception_multi alike.
for (const product of ["reception", "reception_multi"] as const) {
  for (const path of ["inbound"] as const) {
    // override unset × client unset/set → today's path, no resolver.
    table.push({ name: `${product} unset, client unset`, path, product, client: NOT_SET, override: null, language: "fr", today: IN_TODAY, want: today(IN_TODAY, "default") });
    table.push({ name: `${product} unset, client set (2.1)`, path, product, client: SET_21, override: null, language: "fr", today: { engine: "openai", model: "gpt-realtime-2.1" }, want: today({ engine: "openai", model: "gpt-realtime-2.1" }, "client") });
    // override set × client set → today's client values, nothing ignored.
    table.push({ name: `${product} set xai, client set (xai)`, path, product, client: SET_XAI, override: { engine: "gemini", model: null }, language: "fr", today: { engine: "xai", model: "gpt-realtime-2" }, want: today({ engine: "xai", model: "gpt-realtime-2" }, "client") });
    table.push({ name: `${product} set openai 2.1, client set (2.1) + he`, path, product, client: SET_21, override: { engine: "xai", model: null }, language: "he", today: { engine: "openai", model: "gpt-realtime-2.1" }, want: today({ engine: "openai", model: "gpt-realtime-2.1" }, "client") });
    // override set × client unset × language supported × honoured → applied.
    table.push({ name: `${product} openai 2.1, fr`, path, product, client: NOT_SET, override: { engine: "openai", model: "gpt-realtime-2.1" }, language: "fr", today: IN_TODAY, want: { apply: true, engine: "openai", model: "gpt-realtime-2.1", servedModel: "gpt-realtime-2.1", source: "product" } });
    table.push({ name: `${product} xai default model, en`, path, product, client: NOT_SET, override: { engine: "xai", model: null }, language: "en", today: IN_TODAY, want: { apply: true, engine: "xai", model: X, servedModel: "gpt-realtime-2", source: "product" } });
    table.push({ name: `${product} gemini env model named, fr`, path, product, client: NOT_SET, override: { engine: "gemini", model: G }, language: "fr", today: IN_TODAY, want: { apply: true, engine: "gemini", model: G, servedModel: "gpt-realtime-2", source: "product" } });
    // language unsupported → today + ignored(language).
    table.push({ name: `${product} xai, he (no Hebrew)`, path, product, client: NOT_SET, override: { engine: "xai", model: null }, language: "he", today: IN_TODAY, want: { ...today(IN_TODAY, "default"), ignored: { reason: "language", wanted: { source: "product", engine: "xai", model: null } } } });
    table.push({ name: `${product} gemini, unknown language`, path, product, client: NOT_SET, override: { engine: "gemini", model: null }, language: "de", today: IN_TODAY, want: { ...today(IN_TODAY, "default"), ignored: { reason: "language", wanted: { source: "product", engine: "gemini", model: null } } } });
    // not honoured (a forced Gemini/Grok model) → today + ignored(not_honoured).
    table.push({ name: `${product} xai forced model`, path, product, client: NOT_SET, override: { engine: "xai", model: "grok-other" }, language: "fr", today: IN_TODAY, want: { ...today(IN_TODAY, "default"), ignored: { reason: "not_honoured", wanted: { source: "product", engine: "xai", model: "grok-other" } } } });
    // An override equal to today's values = today's path (no change).
    table.push({ name: `${product} openai 2 = today`, path, product, client: NOT_SET, override: { engine: "openai", model: "gpt-realtime-2" }, language: "fr", today: IN_TODAY, want: today(IN_TODAY, "default") });
  }
}
// Inbound with no reception product → today's path whatever is set.
table.push({ name: "inbound, no reception product", path: "inbound", product: null, client: NOT_SET, override: null, language: "fr", today: IN_TODAY, want: today(IN_TODAY, "default") });
// Sales: campaign and outbound_test alike.
for (const path of ["campaign", "outbound_test"] as const) {
  table.push({ name: `${path} unset`, path, product: "sales", client: null, override: null, language: "fr", today: OUT_TODAY, want: today(OUT_TODAY, "default") });
  // The receptionist's client setting is NOT a sales setting (VP 2026-11-22).
  table.push({ name: `${path} unset, receptionist client set`, path, product: "sales", client: SET_21, override: null, language: "fr", today: OUT_TODAY, want: today(OUT_TODAY, "default") });
  table.push({ name: `${path} set 2.1, receptionist client set (xai)`, path, product: "sales", client: SET_XAI, override: { engine: "openai", model: "gpt-realtime-2.1" }, language: "fr", today: OUT_TODAY, want: { apply: true, engine: "openai", model: "gpt-realtime-2.1", servedModel: "gpt-realtime-2.1", source: "product" } });
  table.push({ name: `${path} set 2.1, he`, path, product: "sales", client: null, override: { engine: "openai", model: "gpt-realtime-2.1" }, language: "he", today: OUT_TODAY, want: { apply: true, engine: "openai", model: "gpt-realtime-2.1", servedModel: "gpt-realtime-2.1", source: "product" } });
  table.push({ name: `${path} set openai default model = env model`, path, product: "sales", client: null, override: { engine: "openai", model: null }, language: "fr", today: OUT_TODAY, want: today(OUT_TODAY, "default") });
  table.push({ name: `${path} set gemini (not honoured for sales)`, path, product: "sales", client: null, override: { engine: "gemini", model: null }, language: "fr", today: OUT_TODAY, want: { ...today(OUT_TODAY, "default"), ignored: { reason: "not_honoured", wanted: { source: "product", engine: "gemini", model: null } } } });
  table.push({ name: `${path} set 2.1, unknown language`, path, product: "sales", client: null, override: { engine: "openai", model: "gpt-realtime-2.1" }, language: "de", today: OUT_TODAY, want: { ...today(OUT_TODAY, "default"), ignored: { reason: "language", wanted: { source: "product", engine: "openai", model: "gpt-realtime-2.1" } } } });
  // E2b hook: clientSalesOverride is null in E2 → exactly the row without it.
  table.push({ name: `${path} set 2.1, clientSalesOverride null (E2b hook)`, path, product: "sales", client: null, override: { engine: "openai", model: "gpt-realtime-2.1" }, language: "fr", today: OUT_TODAY, clientSalesOverride: null, want: { apply: true, engine: "openai", model: "gpt-realtime-2.1", servedModel: "gpt-realtime-2.1", source: "product" } });
  table.push({ name: `${path} unset, clientSalesOverride null (E2b hook)`, path, product: "sales", client: null, override: null, language: "fr", today: OUT_TODAY, clientSalesOverride: null, want: today(OUT_TODAY, "default") });
}
for (const r of table) {
  const got = engineForCall({
    path: r.path,
    product: r.product,
    client: r.client,
    overrides: r.product ? ov(r.product, r.override) : noEngineOverrides(),
    language: r.language,
    languages: L,
    today: r.today,
    ...(r.clientSalesOverride === null ? { clientSalesOverride: null } : {}),
  });
  assert.deepEqual(got, r.want, `engineForCall: ${r.name}`);
}
// An override on ANOTHER product never touches this call.
for (const p of PRODUCTS) {
  const others = { ...noEngineOverrides() };
  for (const q of PRODUCTS) if (q !== p) others[q] = { engine: "openai", model: "gpt-realtime-2.1" };
  const path: CallPath = p === "sales" ? "campaign" : "inbound";
  const t = p === "sales" ? OUT_TODAY : IN_TODAY;
  if (p === "connect") continue;
  assert.equal(engineForCall({ path, product: p, client: NOT_SET, overrides: others, language: "fr", languages: L, today: t }).apply, false, `other products' overrides don't touch ${p}`);
}
console.log(`ok: engineForCall table (${table.length} rows)`);

// productForPath
assert.equal(productForPath("inbound", ["reception_multi", "sales"]), "reception_multi");
assert.equal(productForPath("inbound", ["sales", "reception"]), "reception");
assert.equal(productForPath("inbound", ["sales", "connect"]), null);
assert.equal(productForPath("campaign", []), "sales");
assert.equal(productForPath("outbound_test", ["reception"]), "sales");
console.log("ok: product per path");

// ── 2. Shape, honoured, the stored row ─────────────────────────────────────
assert.deepEqual(parseEngineOverride({ engine: "xai", model: null }), { engine: "xai", model: null });
assert.deepEqual(parseEngineOverride({ model: "gpt-realtime-2.1", engine: "openai" }), { engine: "openai", model: "gpt-realtime-2.1" });
for (const bad of [null, [], "openai", { engine: "openai" }, { engine: "claude", model: null }, { engine: "openai", model: "" }, { engine: "openai", model: "a b" }, { engine: "openai", model: null, extra: 1 }, { engine: "openai", model: 2 }]) {
  assert.equal(parseEngineOverride(bad), null, `shape refused: ${JSON.stringify(bad)}`);
}
const honouredTable: Array<[Product, EngineOverride, string[]]> = [
  ["reception", { engine: "openai", model: "gpt-realtime-2.1" }, []],
  ["reception", { engine: "gemini", model: null }, []],
  ["reception", { engine: "gemini", model: G }, []],
  ["reception", { engine: "gemini", model: "gemini-other" }, ["model"]],
  ["reception_multi", { engine: "xai", model: X }, []],
  ["reception_multi", { engine: "xai", model: "grok-other" }, ["model"]],
  ["sales", { engine: "openai", model: "gpt-realtime-mini" }, []],
  ["sales", { engine: "gemini", model: null }, ["engine"]],
  ["sales", { engine: "xai", model: X }, ["engine"]],
  ["connect", { engine: "openai", model: null }, ["engine"]],
];
for (const [p, o, want] of honouredTable) assert.deepEqual(engineOverrideProblems(p, o), want, `problems ${p} ${JSON.stringify(o)}`);
console.log("ok: override shape + honoured at write");

const D = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
const NONE = noEngineOverrides();
// No override → exactly the pre-E2 bytes.
assert.equal(serializeCatalogueRow(D), JSON.stringify(D));
assert.equal(serializeCatalogueRow(D, NONE), JSON.stringify(D));
assert.deepEqual(parseCatalogueRow(JSON.parse(JSON.stringify(D))), { catalogue: D, engineOverrides: NONE });
// With an override: round trip, the prices unchanged, the key after EUR / ILS.
const withO = { ...NONE, reception: { engine: "xai", model: null } as EngineOverride };
const text = serializeCatalogueRow(D, withO);
assert.match(text, /"reception":\{"EUR":\{[^}]*\},"ILS":\{[^}]*\},"engineOverride":\{"engine":"xai","model":null\}\}/);
assert.deepEqual(parseCatalogueRow(JSON.parse(text)), { catalogue: D, engineOverrides: withO });
// A malformed override fails the whole row (strict).
for (const badO of [{ engine: "x", model: null }, null, "xai", { engine: "openai" }]) {
  const raw = JSON.parse(JSON.stringify(D));
  raw.sales.engineOverride = badO;
  assert.equal(parseCatalogueRow(raw), null, `row refused: ${JSON.stringify(badO)}`);
}
{
  const raw = JSON.parse(JSON.stringify(D));
  raw.gold = { engineOverride: { engine: "openai", model: null } };
  assert.equal(parseCatalogueRow(raw), null, "unknown product with an override refused");
}
// The write: set / clear / omitted = kept / not honoured refused (named).
const stored = { catalogue: D, engineOverrides: withO };
for (const body of [{}, { catalogue: {} }, { catalogue: { reception: {} } }, { catalogue: { sales: { EUR: {} } } }]) {
  assert.deepEqual(catalogueRowWrite(stored, body), { ok: true, value: D, engineOverrides: withO, changed: false }, `omitted keeps the override: ${JSON.stringify(body)}`);
}
{
  const w = catalogueRowWrite(stored, { catalogue: { reception: { engineOverride: { engine: "xai", model: null } } } });
  assert.deepEqual(w, { ok: true, value: D, engineOverrides: withO, changed: false }, "an unchanged re-send");
}
{
  const w = catalogueRowWrite(stored, { catalogue: { sales: { engineOverride: { engine: "openai", model: "gpt-realtime-2.1" } } } });
  assert.ok(w.ok && w.changed);
  assert.deepEqual(w.ok && w.engineOverrides, { ...withO, sales: { engine: "openai", model: "gpt-realtime-2.1" } }, "set: only that product");
  assert.equal(stored.engineOverrides.sales, null, "the stored value is never mutated");
}
{
  const w = catalogueRowWrite(stored, { catalogue: { reception: { engineOverride: null } } });
  assert.deepEqual(w, { ok: true, value: D, engineOverrides: NONE, changed: true }, "null clears");
  assert.equal(serializeCatalogueRow(w.ok ? w.value : D, w.ok ? w.engineOverrides : NONE), JSON.stringify(D), "cleared = the pre-E2 bytes again");
}
{
  const w = catalogueRowWrite(stored, { catalogue: { connect: { ILS: { monthly: 219 } }, sales: { engineOverride: { engine: "gemini", model: null } } } });
  assert.deepEqual(w, { ok: false, error: "invalid_catalogue", fields: ["catalogue.sales.engineOverride.engine"] }, "not honoured for sales → refused, nothing written");
}
{
  const w = catalogueRowWrite(stored, { catalogue: { reception: { engineOverride: { engine: "xai", model: "grok-other" } } } });
  assert.deepEqual(w, { ok: false, error: "invalid_catalogue", fields: ["catalogue.reception.engineOverride.model"] });
}
{
  const w = catalogueRowWrite(stored, { catalogue: { connect: { engineOverride: { engine: "openai", model: null } } } });
  assert.deepEqual(w, { ok: false, error: "invalid_catalogue", fields: ["catalogue.connect.engineOverride.engine"] });
}
{
  const w = catalogueRowWrite(stored, { catalogue: { reception: { engineOverride: { engine: "openai" } }, gold: { engineOverride: null }, sales: { EUR: { monthly: -1 } } } });
  assert.equal(w.ok, false);
  assert.deepEqual(!w.ok && [...w.fields].sort(), ["catalogue.gold", "catalogue.reception.engineOverride", "catalogue.sales.EUR.monthly"]);
}
// A price write keeps the stored override.
{
  const w = catalogueRowWrite(stored, { catalogue: { connect: { ILS: { monthly: 219 } } } });
  assert.ok(w.ok && w.changed);
  assert.deepEqual(w.ok && w.engineOverrides, withO);
}
console.log("ok: stored row (parse, bytes, write)");

// Coverage for the admin form: honoured flags + languages per option.
{
  const sales = engineOptionCoverage("sales", L);
  assert.ok(sales.filter((o) => o.engine !== "openai").every((o) => !o.honoured), "sales: Gemini / Grok disabled");
  assert.ok(sales.filter((o) => o.engine === "openai").every((o) => o.honoured));
  const rec = engineOptionCoverage("reception", L);
  assert.deepEqual(rec.find((o) => o.engine === "xai" && o.model === null), { engine: "xai", model: null, honoured: true, languages: ["fr", "en"] });
  assert.deepEqual(rec.find((o) => o.engine === "openai" && o.model === "gpt-realtime-2.1"), { engine: "openai", model: "gpt-realtime-2.1", honoured: true, languages: ["fr", "en", "he"] });
  assert.ok(engineOptionCoverage("connect", L).every((o) => !o.honoured), "connect: nothing honoured");
  const custom: EngineLanguages = { ...L, gemini: { "*": ["fr"], "gemini-x": ["fr", "he"] } };
  assert.deepEqual(engineOptionCoverage("reception", custom).find((o) => o.model === "gemini-x"), { engine: "gemini", model: "gemini-x", honoured: false, languages: ["fr", "he"] });
}
console.log("ok: option coverage");

// ── 3. voiceOnEngine ────────────────────────────────────────────────────────
{
  const row = { voice: "marin", model: "gpt-realtime-2", speed: 1, realtimeProvider: null, voiceProfile: null, noiseReductionLevel: null };
  const v = servedInboundVoice(row, "gpt-realtime-2");
  // OpenAI → OpenAI with another model: only the model.
  const o = voiceOnEngine(v, { engine: "openai", servedModel: "gpt-realtime-2.1" });
  assert.deepEqual(o, { ...v, advanced: { ...v.advanced, model: "gpt-realtime-2.1" } });
  // OpenAI → Grok: the equivalent in voiceOverrides.xai, the voice column kept.
  const x = voiceOnEngine(v, { engine: "xai", servedModel: "gpt-realtime-2" });
  assert.equal(x.engine, "xai");
  assert.equal(x.voiceId, "marin");
  assert.equal(x.advanced.voiceOverrides.xai, "eve", "marin (F rank 1) → eve (F rank 1)");
  assert.equal(x.advanced.model, "gpt-realtime-2", "no Grok model value served");
  const s = toEngineSettings(x, { defaultModel: "gpt-realtime-2" });
  assert.equal(s.realtimeProvider, "xai");
  assert.equal(s.model, "gpt-realtime-2");
  assert.equal(s.voice, "marin");
  assert.equal(s.voiceProfile.voiceOverrides.xai, "eve");
  // A male voice keeps its gender on Gemini.
  const g = voiceOnEngine(servedInboundVoice({ ...row, voice: "cedar" }, "gpt-realtime-2"), { engine: "gemini", servedModel: "gpt-realtime-2" });
  assert.equal(g.advanced.voiceOverrides.gemini, "Achird");
  // The input is never mutated.
  assert.deepEqual(v, fromInboundColumns(row));
}
console.log("ok: voice follows the engine through the equivalence table");

// ── 4. Source guards ───────────────────────────────────────────────────────
{
  const inbound = code("lib/agent/session-config/inbound.ts");
  assert.match(inbound, /const todayVoice = servedInboundVoice\(tenant\.config, tenant\.config\.model \|\| "gpt-realtime-2"\);/);
  assert.match(inbound, /const voiceConfig = engineDecision\.apply \? voiceOnEngine\(todayVoice, engineDecision\) : todayVoice;/);
  assert.match(inbound, /decideInboundEngine\(tenant\.user\.id, tenant\.config, fx\.alertAdmins, fx\.engineDeps\)/, "inbound alerts through fx (dry run silent)");
  assert.match(inbound, /\{ path: "inbound", alert: fx\.alertAdmins, today: inboundToday\(tenant\.config\) \}/, "the fail-open alert goes through fx too");
  assert.match(inbound, /const engine = toEngineSettings\(voiceConfig, \{ defaultModel: tenant\.config\.model \|\| "gpt-realtime-2" \}\);/, "today's toEngineSettings call, unchanged");
  for (const [f, path, uid] of [["lib/agent/session-config/campaign.ts", "campaign", "campaign.userId"], ["lib/agent/session-config/outbound-test.ts", "outbound_test", "agent.userId"]]) {
    const c = code(f);
    assert.match(c, /const voiceConfig = engineDecision\.apply \? voiceOnEngine\(todayVoice, engineDecision\) : todayVoice;/, f);
    assert.match(c, /const salesToday = \{ engine: "openai" as const, model: outboundModel\(\) \};/, f);
    assert.match(c, new RegExp(`decideSalesEngine\\("${path}", ${uid.replace(".", "\\.")}, persona\\.language \\|\\| "fr", salesToday, engineAlert, engineFx\\.deps\\)`), f);
    assert.match(c, /const engine = toEngineSettings\(voiceConfig, \{ defaultModel: outboundModel\(\) \}\);/, f);
    assert.doesNotMatch(c, /realtimeProvider/, `${f}: no new served field (sales payloads carry no realtimeProvider)`);
  }
  // Never served: no handler serves the override or the catalogue row.
  for (const f of ["lib/agent/session-config/inbound.ts", "lib/agent/session-config/campaign.ts", "lib/agent/session-config/outbound-test.ts"]) {
    const c = code(f);
    assert.doesNotMatch(c, /engineOverride|getCatalogueRow|getEngineOverrides|engineDecision[,\s}]*\}\)/, `${f}: the override is never served`);
    assert.doesNotMatch(c, /\.\.\.engineDecision/, `${f}: the decision is never spread into a payload`);
  }
  // The public landing never imports the row module (it names engines).
  for (const f of ["lib/product-catalogue.ts", "lib/public-plan-pricing.ts", "components/marketing/Pricing.tsx", "app/api/public/plan-pricing/route.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /product-catalogue-row|engine-override|engine-resolve|realtime-provider/, `${f} stays engine-free`);
  }
  // Admin-only first.
  for (const f of ["app/api/admin/product-catalogue/route.ts", "app/api/admin/users/[userId]/engine/route.ts"]) {
    const c = code(f);
    for (const m of ["GET", "PUT"]) {
      const i = c.indexOf(`export async function ${m}`);
      if (i < 0) continue;
      assert.match(c.slice(i, i + 260), /const guard = await requireAdmin\(\);\s*if \(!guard\.ok\) return guard\.response;/, `${f} ${m} admin-only first`);
    }
  }
  // The banner uses the call path's decide* functions (screen = call).
  const banner = code("app/api/admin/users/[userId]/engine/route.ts");
  assert.match(banner, /decideInboundEngine\(userId, config, NO_ENGINE_ALERT\)/);
  assert.match(banner, /decideSalesEngine\("campaign", userId, l, \{ engine: "openai", model: outboundModel\(\) \}, NO_ENGINE_ALERT\)/);
  assert.doesNotMatch(banner, /db\.select\(\)/, "explicit picks only");
}
console.log("ok: source guards");
console.log("ALL ENGINE-OVERRIDE TESTS PASSED");
