// The pure engine resolver (lib/engine-resolve.ts): the "client setting set"
// rule, honouredOptions per product (what the worker honours today), and
// resolveEngine as a full table — order client > product > default, with the
// language guard and the not-honoured guard falling through and recording
// `ignored`. Nothing on the call path calls it yet (E1). Mock data only.
// Run with:  npx tsx scripts/tests/engine-resolve.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_ENGINE_LANGUAGES, type EngineLanguages } from "../../lib/engine-languages";
import {
  CLIENT_DEFAULT_MODEL,
  clientSettingSet,
  honouredOptions,
  isHonoured,
  resolveEngine,
  type ClientEngineColumns,
  type HonouredOptions,
  type ResolveEngineInput,
  type ResolvedEngine,
} from "../../lib/engine-resolve";
import { PRODUCTS, type Product } from "../../lib/product-values";
import { REALTIME_PROVIDER_MODEL, REALTIME_PROVIDERS } from "../../lib/realtime-provider";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── "Client setting set" ──────────────────────────────────────────────────
assert.equal(CLIENT_DEFAULT_MODEL, "gpt-realtime-2");
// The rule must match the column default in the schema (and migration 0012).
assert.match(readFileSync("lib/db/schema.ts", "utf8"), /model: text\("model"\)\.notNull\(\)\.default\("gpt-realtime-2"\)/);
assert.match(readFileSync("drizzle/0012_default_model_realtime_2.sql", "utf8"), /SET DEFAULT 'gpt-realtime-2'/);
const setTable: Array<[string, ClientEngineColumns | null, boolean]> = [
  ["no row", null, false],
  ["untouched tenant (NULL + column default)", { realtimeProvider: null, model: "gpt-realtime-2" }, false],
  ["'openai' stored + default model", { realtimeProvider: "openai", model: "gpt-realtime-2" }, false],
  ["NULL + empty model", { realtimeProvider: null, model: "" }, false],
  ["NULL + undefined model", { realtimeProvider: undefined, model: undefined }, false],
  ["NULL + padded default model", { realtimeProvider: null, model: "  gpt-realtime-2 " }, false],
  ["unknown provider string = openai", { realtimeProvider: "mystery", model: "gpt-realtime-2" }, false],
  ["admin picked gpt-realtime-2.1", { realtimeProvider: null, model: "gpt-realtime-2.1" }, true],
  ["admin raw model select (mini)", { realtimeProvider: null, model: "gpt-realtime-mini" }, true],
  ["gemini engine", { realtimeProvider: "gemini", model: "gpt-realtime-2" }, true],
  ["xai engine (model column unused)", { realtimeProvider: "xai", model: "gpt-realtime-2.1" }, true],
];
for (const [name, c, want] of setTable) assert.equal(clientSettingSet(c), want, `clientSettingSet: ${name}`);
console.log("ok: client setting set rule");

// ── honouredOptions: a table per product ──────────────────────────────────
const G = REALTIME_PROVIDER_MODEL.gemini;
const X = REALTIME_PROVIDER_MODEL.xai;
const expectHonoured: Record<Product, HonouredOptions> = {
  reception: { openai: { engine: true, models: "any" }, gemini: { engine: true, models: [G] }, xai: { engine: true, models: [X] } },
  reception_multi: { openai: { engine: true, models: "any" }, gemini: { engine: true, models: [G] }, xai: { engine: true, models: [X] } },
  sales: { openai: { engine: true, models: "any" }, gemini: { engine: false, models: [] }, xai: { engine: false, models: [] } },
  connect: { openai: { engine: false, models: [] }, gemini: { engine: false, models: [] }, xai: { engine: false, models: [] } },
};
for (const p of PRODUCTS) assert.deepEqual(honouredOptions(p), expectHonoured[p], `honouredOptions(${p})`);
assert.notEqual(honouredOptions("sales").gemini, honouredOptions("sales").xai, "fresh objects");
const isHonTable: Array<[Product, (typeof REALTIME_PROVIDERS)[number], string | null, boolean]> = [
  ["reception", "openai", null, true],
  ["reception", "openai", "gpt-realtime-2.1", true],
  ["reception", "gemini", null, true],
  ["reception", "gemini", G, true],
  ["reception", "gemini", "gemini-other-live", false], // a forced Gemini model
  ["reception", "xai", X, true],
  ["reception", "xai", "grok-voice-think-fast-1.0", false], // a forced Grok model
  ["reception_multi", "xai", null, true],
  ["sales", "openai", "gpt-realtime-2.1", true],
  ["sales", "gemini", null, false],
  ["sales", "xai", null, false],
  ["connect", "openai", null, false],
  ["connect", "openai", "gpt-realtime-2", false],
  ["connect", "gemini", null, false],
];
for (const [p, e, m, want] of isHonTable) assert.equal(isHonoured(honouredOptions(p), e, m), want, `isHonoured(${p}, ${e}, ${m})`);
console.log("ok: honouredOptions + isHonoured tables");

// ── resolveEngine: a full table ───────────────────────────────────────────
const DEF = { engine: "openai" as const, model: "gpt-realtime-2" };
const UNTOUCHED: ClientEngineColumns = { realtimeProvider: null, model: "gpt-realtime-2" };
const base = (over: Partial<ResolveEngineInput>): ResolveEngineInput => ({
  product: "reception",
  client: UNTOUCHED,
  productOverride: null,
  globalDefault: DEF,
  language: "fr",
  languages: DEFAULT_ENGINE_LANGUAGES,
  honoured: honouredOptions(over.product ?? "reception"),
  ...over,
});
const heGemini: EngineLanguages = structuredClone(DEFAULT_ENGINE_LANGUAGES);
heGemini.gemini["*"] = ["fr", "en", "he"];
const miniEnOnly: EngineLanguages = structuredClone(DEFAULT_ENGINE_LANGUAGES);
miniEnOnly.openai["gpt-realtime-mini"] = ["en"];

const rows: Array<[string, Partial<ResolveEngineInput>, ResolvedEngine]> = [
  // Nothing set → today's default, nothing ignored.
  ["untouched, no override", {}, { ...DEF, source: "default" }],
  ["no client row, no override", { client: null }, { ...DEF, source: "default" }],
  // Product override applies to an untouched client.
  ["untouched + product xai", { productOverride: { engine: "xai", model: null } }, { engine: "xai", model: X, source: "product" }],
  ["untouched + product openai 2.1", { productOverride: { engine: "openai", model: "gpt-realtime-2.1" } }, { engine: "openai", model: "gpt-realtime-2.1", source: "product" }],
  ["untouched + product openai, model null = default model", { productOverride: { engine: "openai", model: null } }, { ...DEF, source: "product" }],
  ["untouched + product gemini, padded empty model", { productOverride: { engine: "gemini", model: "  " } }, { engine: "gemini", model: G, source: "product" }],
  // Client beats product.
  ["client xai beats product gemini", { client: { realtimeProvider: "xai", model: "gpt-realtime-2" }, productOverride: { engine: "gemini", model: null } }, { engine: "xai", model: X, source: "client" }],
  ["client openai 2.1 beats product xai", { client: { realtimeProvider: null, model: "gpt-realtime-2.1" }, productOverride: { engine: "xai", model: null } }, { engine: "openai", model: "gpt-realtime-2.1", source: "client" }],
  ["client set, no override", { client: { realtimeProvider: "gemini", model: "gpt-realtime-2" } }, { engine: "gemini", model: G, source: "client" }],
  ["client padded model is trimmed", { client: { realtimeProvider: null, model: " gpt-realtime-2.1 " } }, { engine: "openai", model: "gpt-realtime-2.1", source: "client" }],
  // Language guard: Hebrew account.
  [
    "he: client xai skipped → product openai",
    { language: "he", client: { realtimeProvider: "xai", model: "gpt-realtime-2" }, productOverride: { engine: "openai", model: "gpt-realtime-2.1" } },
    { engine: "openai", model: "gpt-realtime-2.1", source: "product", ignored: { reason: "language", wanted: { source: "client", engine: "xai", model: null } }, ignoredAll: [{ reason: "language", wanted: { source: "client", engine: "xai", model: null } }] },
  ],
  [
    "he: product gemini skipped → default",
    { language: "he", productOverride: { engine: "gemini", model: null } },
    { ...DEF, source: "default", ignored: { reason: "language", wanted: { source: "product", engine: "gemini", model: null } }, ignoredAll: [{ reason: "language", wanted: { source: "product", engine: "gemini", model: null } }] },
  ],
  [
    "he: client xai AND product gemini skipped → default, both recorded",
    { language: "he", client: { realtimeProvider: "xai", model: "gpt-realtime-2" }, productOverride: { engine: "gemini", model: null } },
    {
      ...DEF,
      source: "default",
      ignored: { reason: "language", wanted: { source: "client", engine: "xai", model: null } },
      ignoredAll: [
        { reason: "language", wanted: { source: "client", engine: "xai", model: null } },
        { reason: "language", wanted: { source: "product", engine: "gemini", model: null } },
      ],
    },
  ],
  ["he: gemini allowed once the table says so", { language: "he", languages: heGemini, productOverride: { engine: "gemini", model: null } }, { engine: "gemini", model: G, source: "product" }],
  ["fr: xai speaks French", { language: "fr", productOverride: { engine: "xai", model: null } }, { engine: "xai", model: X, source: "product" }],
  [
    "unknown language (de): override skipped → default",
    { language: "de", productOverride: { engine: "openai", model: "gpt-realtime-2.1" } },
    { ...DEF, source: "default", ignored: { reason: "language", wanted: { source: "product", engine: "openai", model: "gpt-realtime-2.1" } }, ignoredAll: [{ reason: "language", wanted: { source: "product", engine: "openai", model: "gpt-realtime-2.1" } }] },
  ],
  [
    "per-model language entry: client mini (en only) on a fr account → default",
    { languages: miniEnOnly, client: { realtimeProvider: null, model: "gpt-realtime-mini" } },
    { ...DEF, source: "default", ignored: { reason: "language", wanted: { source: "client", engine: "openai", model: "gpt-realtime-mini" } }, ignoredAll: [{ reason: "language", wanted: { source: "client", engine: "openai", model: "gpt-realtime-mini" } }] },
  ],
  // Not honoured (VP (ii)).
  [
    "reception: forced Gemini model not honoured → default",
    { productOverride: { engine: "gemini", model: "gemini-other-live" } },
    { ...DEF, source: "default", ignored: { reason: "not_honoured", wanted: { source: "product", engine: "gemini", model: "gemini-other-live" } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "product", engine: "gemini", model: "gemini-other-live" } }] },
  ],
  ["reception: Gemini forced to its own default model is honoured", { productOverride: { engine: "gemini", model: G } }, { engine: "gemini", model: G, source: "product" }],
  [
    "sales: product xai not honoured → default",
    { product: "sales", productOverride: { engine: "xai", model: null } },
    { ...DEF, source: "default", ignored: { reason: "not_honoured", wanted: { source: "product", engine: "xai", model: null } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "product", engine: "xai", model: null } }] },
  ],
  [
    "sales: client gemini not honoured → product openai 2.1",
    { product: "sales", client: { realtimeProvider: "gemini", model: "gpt-realtime-2" }, productOverride: { engine: "openai", model: "gpt-realtime-2.1" } },
    { engine: "openai", model: "gpt-realtime-2.1", source: "product", ignored: { reason: "not_honoured", wanted: { source: "client", engine: "gemini", model: null } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "client", engine: "gemini", model: null } }] },
  ],
  ["sales: product openai 2.1 honoured", { product: "sales", productOverride: { engine: "openai", model: "gpt-realtime-2.1" } }, { engine: "openai", model: "gpt-realtime-2.1", source: "product" }],
  [
    "connect: any override not honoured → default",
    { product: "connect", productOverride: { engine: "openai", model: "gpt-realtime-2.1" } },
    { ...DEF, source: "default", ignored: { reason: "not_honoured", wanted: { source: "product", engine: "openai", model: "gpt-realtime-2.1" } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "product", engine: "openai", model: "gpt-realtime-2.1" } }] },
  ],
  [
    "connect: client setting not honoured either → default",
    { product: "connect", client: { realtimeProvider: "xai", model: "gpt-realtime-2" } },
    { ...DEF, source: "default", ignored: { reason: "not_honoured", wanted: { source: "client", engine: "xai", model: null } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "client", engine: "xai", model: null } }] },
  ],
  ["connect: nothing set → default, nothing ignored", { product: "connect" }, { ...DEF, source: "default" }],
  // Not-honoured is checked before the language (one reason per skipped choice).
  [
    "sales + he: client xai → not_honoured (not language)",
    { product: "sales", language: "he", client: { realtimeProvider: "xai", model: "gpt-realtime-2" } },
    { ...DEF, source: "default", ignored: { reason: "not_honoured", wanted: { source: "client", engine: "xai", model: null } }, ignoredAll: [{ reason: "not_honoured", wanted: { source: "client", engine: "xai", model: null } }] },
  ],
  // The default is never skipped, even when it does not speak the language.
  ["unknown language, nothing set → default as is", { language: "de" }, { ...DEF, source: "default" }],
  // A non-OpenAI global default: an OpenAI override with model null runs the OpenAI display default.
  ["global default xai, product openai model null", { globalDefault: { engine: "xai", model: X }, productOverride: { engine: "openai", model: null } }, { engine: "openai", model: REALTIME_PROVIDER_MODEL.openai, source: "product" }],
];
for (const [name, over, want] of rows) assert.deepEqual(resolveEngine(base(over)), want, `resolveEngine: ${name}`);
// No `ignored` key at all when nothing was skipped (E2 tests `"ignored" in r`).
assert.equal("ignored" in resolveEngine(base({})), false);
assert.equal("ignoredAll" in resolveEngine(base({ productOverride: { engine: "xai", model: null } })), false);
console.log(`ok: resolveEngine table (${rows.length} rows)`);

// ── Nothing on the call path calls the resolver yet (E1) ─────────────────
for (const f of [
  "app/api/agent/session-config/route.ts",
  "app/api/agent/config/route.ts",
  "app/api/agent/campaign-config/route.ts",
  "app/api/agent/outbound-test-config/route.ts",
  "lib/voice/engine.ts",
]) {
  assert.doesNotMatch(code(f), /engine-resolve|resolveEngine|engine-languages/, `${f} is not wired (E2)`);
}
// The resolver is pure: no db, no network, no env.
const src = code("lib/engine-resolve.ts");
assert.doesNotMatch(src, /lib\/db|fetch\(|process\.env/);

console.log("ALL ENGINE-RESOLVE TESTS PASSED");
