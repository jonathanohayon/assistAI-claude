// No supplier name in what tenants receive (production-build proof:
// scripts/check-tenant-bundle.mjs). Cheap static guards for the two places
// that leaked: translations shipped to tenant pages, and the plan objects.
// Run with:  npx tsx scripts/tests/no-supplier-names-tenant.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ADMIN_ONLY_NAMESPACES } from "../../i18n/public-namespaces";
import { PLANS } from "../../lib/plans";
import { PATTERN } from "../tenant-bundle-match.mjs";

// The bundle guard's own list (suppliers, model ids, tool names), without
// the global flag so each assertion starts from the beginning.
const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// 1. Translations: every namespace a tenant can receive (keys AND values).
function* walk(o: unknown, path: string): Generator<[string, string]> {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      yield [`${path}.${k}`, k];
      yield* walk(v, `${path}.${k}`);
    }
  } else if (typeof o === "string") yield [path, o];
}
for (const l of ["en", "fr", "he"]) {
  const messages = JSON.parse(read(`messages/${l}.json`)) as Record<string, unknown>;
  for (const [ns, body] of Object.entries(messages)) {
    if (ADMIN_ONLY_NAMESPACES.includes(ns)) continue;
    for (const [path, text] of walk(body, ns)) {
      assert.doesNotMatch(text, SUPPLIER, `${l}: ${path} names a supplier: "${text.slice(0, 80)}"`);
    }
  }
}

// 2. Plans ship to every page (pricing, settings): no engine/model field.
for (const p of PLANS) {
  assert.ok(!("model" in p), `plan ${p.key} has a model field`);
  assert.doesNotMatch(JSON.stringify(p), SUPPLIER, `plan ${p.key} names a supplier`);
}

// 3. The tenant dashboard's prompt preview copy.
assert.doesNotMatch(read("app/[locale]/dashboard/prompt-preview.tsx").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""), /OpenAI|Realtime/);

console.log("ALL NO-SUPPLIER-NAMES TESTS PASSED");
