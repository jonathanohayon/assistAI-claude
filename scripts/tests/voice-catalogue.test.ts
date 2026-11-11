// Unit tests for lib/voice/catalogue.ts (V8a).
// Run with:  npx tsx scripts/tests/voice-catalogue.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REALTIME_PROVIDERS } from "../../lib/realtime-provider";
import {
  catalogueIdFor,
  catalogueVoice,
  engineVoices,
  equivalenceTable,
  equivalentVoice,
  recommendedVoices,
  VOICE_CATALOGUE,
} from "../../lib/voice/catalogue";
import { RECOMMENDED_VOICE_IDS, VOICE_IDS } from "../../lib/voice/public";

const name = (id: string) => catalogueVoice(id)!.name;

// Sizes and genders as the providers publish them.
const count = (e: (typeof REALTIME_PROVIDERS)[number], g?: "f" | "m") => engineVoices(e).filter((v) => !g || v.gender === g).length;
assert.equal(count("openai"), 13);
assert.equal(count("gemini"), 30);
assert.equal(count("gemini", "f"), 14); // Chirp 3: HD table
assert.equal(count("xai"), 28);
assert.equal(count("xai", "f"), 9); // GET /v1/tts/voices, 11/11/2026
assert.equal(count("xai", "m"), 19);
assert.deepEqual(engineVoices("openai").map((v) => v.name).sort(), [...VOICE_IDS].sort(), "same OpenAI voices as the contract");

// Ids: unique, opaque, stable format. Within one engine no two entries map to the same real voice.
const ids = VOICE_CATALOGUE.map((v) => v.id);
assert.equal(new Set(ids).size, ids.length);
for (const v of VOICE_CATALOGUE) assert.match(v.id, /^voice-\d{3}$/);
for (const e of REALTIME_PROVIDERS) {
  const names = engineVoices(e).map((v) => v.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, `${e}: two entries share a real voice`);
}

// 6 recommended per engine: 3 female + 3 male, distinct, interleaved F/M.
for (const e of REALTIME_PROVIDERS) {
  const r = recommendedVoices(e);
  assert.equal(r.length, 6);
  assert.equal(new Set(r.map((v) => v.name)).size, 6, `${e}: 6 distinct recommended voices`);
  assert.deepEqual(r.map((v) => v.gender), ["f", "m", "f", "m", "f", "m"], e);
}
// OpenAI's recommended set is unchanged (the picker and samples use it).
assert.deepEqual(recommendedVoices("openai").map((v) => v.name).sort(), [...RECOMMENDED_VOICE_IDS].sort());

// Equivalence: gender always kept; today's three worker mappings kept.
const eq = (openaiName: string, target: "gemini" | "xai") => equivalentVoice(catalogueIdFor("openai", openaiName)!, target)!.name;
assert.equal(eq("marin", "gemini"), "Sulafat");
assert.equal(eq("cedar", "gemini"), "Achird");
assert.equal(eq("coral", "gemini"), "Aoede");
assert.equal(eq("marin", "xai"), "eve");
assert.equal(eq("cedar", "xai"), "rex");
assert.equal(eq("coral", "xai"), "ara");
const table = equivalenceTable();
for (const v of VOICE_CATALOGUE) {
  for (const e of REALTIME_PROVIDERS) {
    const t = catalogueVoice(table[v.id][e])!;
    assert.equal(t.engine, e);
    assert.equal(t.gender, v.gender, `${v.engine}/${v.name} → ${e}/${t.name} changes gender`);
  }
  assert.equal(table[v.id][v.engine], v.id, "same engine = itself");
}

// THE DEFECT: the 13 OpenAI voices collapsed to 3 on Grok. Now distinct on
// every engine that has room (Grok 9F/19M, Gemini 14F/16M ≥ OpenAI 5F/8M).
for (const target of ["gemini", "xai"] as const) {
  const mapped = engineVoices("openai").map((v) => table[v.id][target]);
  assert.equal(new Set(mapped).size, 13, `${target}: the 13 voices stay 13 distinct voices`);
  const rec = recommendedVoices("openai").map((v) => name(table[v.id][target]));
  assert.equal(new Set(rec).size, 6, `${target}: the 6 recommended cards are 6 distinct voices`);
}
// Round trip for recommended voices: rank r ↔ rank r on every engine.
for (const v of VOICE_CATALOGUE.filter((x) => x.recommendedRank)) {
  for (const e of REALTIME_PROVIDERS) assert.equal(equivalentVoice(table[v.id][e], v.engine)!.id, v.id);
}
assert.equal(catalogueIdFor("xai", " Eve "), catalogueIdFor("xai", "eve"));
assert.equal(catalogueIdFor("openai", "nope"), null);
assert.equal(equivalentVoice("voice-999", "xai"), null);

// The catalogue carries engine names: tenant code must not import it.
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? (d.name === "node_modules" ? [] : walk(p)) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
const tenantFiles = [...walk("app/[locale]"), ...walk("components")];
assert.ok(tenantFiles.length > 50, `scanned ${tenantFiles.length} tenant files`);
const IMPORT_RE = /(?:from\s*|import\s*\(?\s*)["'][^"']*\bvoice\/catalogue["']/;
assert.deepEqual(tenantFiles.filter((f) => IMPORT_RE.test(readFileSync(f, "utf8"))), [], "tenant code imports the catalogue");

console.log("ALL VOICE-CATALOGUE TESTS PASSED");
