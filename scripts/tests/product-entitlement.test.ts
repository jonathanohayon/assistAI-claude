// The pure entitlement rules (lib/product-entitlement.ts) and the product
// values (lib/product-values.ts): a table over every rule, invalid records,
// add-on dedup and the order of entries, plus a guard that both files stay
// client-safe.
// Run with:  npx tsx scripts/tests/product-entitlement.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { entitledProducts, parseProductsRecord, type Entitlement, type EntitlementInput } from "../../lib/product-entitlement";
import { PRODUCT_ENTRIES, PRODUCTS, entryOf } from "../../lib/product-values";

// ── Values ────────────────────────────────────────────────────────────────
assert.deepEqual([...PRODUCTS], ["reception", "reception_multi", "sales", "connect"]);
assert.deepEqual([...PRODUCT_ENTRIES], ["reception", "sales", "connect"]);
assert.equal(entryOf("reception"), "reception");
assert.equal(entryOf("reception_multi"), "reception");
assert.equal(entryOf("sales"), "sales");
assert.equal(entryOf("connect"), "connect");

// ── The table ─────────────────────────────────────────────────────────────
const inp = (subscriptionPlan: string | null, subscriptionStatus: string | null, products: unknown = null): EntitlementInput => ({
  subscriptionPlan,
  subscriptionStatus,
  products,
});
const ent = (base: Entitlement["base"], addons: Entitlement["addons"], entries: Entitlement["entries"], source: Entitlement["source"]): Entitlement => ({
  base,
  addons,
  entries,
  source,
});

const GF_MULTI = ent("reception_multi", [], ["reception"], "grandfathered");
const GF_RECEPTION = ent("reception", [], ["reception"], "grandfathered");
const GF_PREMIUM = ent("reception_multi", ["sales"], ["reception", "sales"], "grandfathered");

const cases: Array<[string, EntitlementInput, Entitlement]> = [
  // Rule 1: a valid record wins over everything.
  ["record reception", inp("premium", "active", { base: "reception", addons: [] }), ent("reception", [], ["reception"], "products")],
  ["record sales over a trial", inp("essential", "trialing", { base: "sales", addons: [] }), ent("sales", [], ["sales"], "products")],
  ["record connect over global", inp("global", "active", { base: "connect", addons: [] }), ent("connect", [], ["connect"], "products")],
  ["record with add-ons", inp(null, null, { base: "reception", addons: ["sales", "connect"] }), ent("reception", ["sales", "connect"], ["reception", "sales", "connect"], "products")],
  ["entries follow PRODUCT_ENTRIES order", inp(null, null, { base: "connect", addons: ["sales", "reception_multi"] }), ent("connect", ["sales", "reception_multi"], ["reception", "sales", "connect"], "products")],
  ["base duplicated in add-ons is dropped", inp(null, null, { base: "sales", addons: ["sales", "connect", "connect"] }), ent("sales", ["connect"], ["sales", "connect"], "products")],
  ["reception + reception_multi = one entry", inp(null, null, { base: "reception", addons: ["reception_multi"] }), ent("reception", ["reception_multi"], ["reception"], "products")],
  // Rule 2: trials.
  ["trialing", inp("essential", "trialing"), GF_MULTI],
  ["trial_paused", inp("premium", "trial_paused"), GF_MULTI],
  ["trialing beats global", inp("global", "trialing"), GF_MULTI],
  // Rule 3: global / whatsapp.
  ["global active", inp("global", "active"), GF_RECEPTION],
  ["whatsapp active", inp("whatsapp", "active"), GF_RECEPTION],
  ["global canceled", inp("global", "canceled"), GF_RECEPTION],
  // Rule 4: everything else.
  ["premium active", inp("premium", "active"), GF_PREMIUM],
  ["legacy essential", inp("essential", "active"), GF_PREMIUM],
  ["unknown plan", inp("platinum", "active"), GF_PREMIUM],
  ["null plan, null status", inp(null, null), GF_PREMIUM],
  ["case matters (GLOBAL is unknown)", inp("GLOBAL", "active"), GF_PREMIUM],
  ["case matters (TRIALING is not a trial)", inp("global", "TRIALING"), GF_RECEPTION],
];

// Invalid records are treated as no record (rules 2-4 apply).
const invalid: unknown[] = [
  undefined,
  null,
  "reception",
  42,
  true,
  [],
  ["reception"],
  {},
  { base: "reception" },
  { addons: [] },
  { base: "gold", addons: [] },
  { base: "Reception", addons: [] },
  { base: "reception", addons: "sales" },
  { base: "reception", addons: ["sales", "gold"] },
  { base: "reception", addons: [null] },
  { base: "reception", addons: [1] },
  { base: null, addons: [] },
  { base: 1, addons: [] },
  { base: "reception", addons: [], extra: true },
  JSON.stringify({ base: "reception", addons: [] }),
];
for (const bad of invalid) {
  cases.push([`invalid ${JSON.stringify(bad)} + premium`, inp("premium", "active", bad), GF_PREMIUM]);
  cases.push([`invalid ${JSON.stringify(bad)} + trial`, inp("premium", "trialing", bad), GF_MULTI]);
  cases.push([`invalid ${JSON.stringify(bad)} + global`, inp("global", "active", bad), GF_RECEPTION]);
  assert.equal(parseProductsRecord(bad), null, `parseProductsRecord(${JSON.stringify(bad)}) → null`);
}

for (const [name, input, want] of cases) {
  assert.deepEqual(entitledProducts(input), want, name);
}

// The result never aliases the caller's add-ons array.
const rec = { base: "reception" as const, addons: ["sales" as const] };
const got = entitledProducts(inp(null, null, rec));
got.addons.push("connect");
assert.deepEqual(rec.addons, ["sales"]);

// ── Client-safe: no db, no server-only, imports limited ───────────────────
const imports = (p: string) => [...readFileSync(p, "utf8").matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
assert.deepEqual(imports("lib/product-values.ts"), [], "product-values has zero imports");
assert.deepEqual(imports("lib/product-entitlement.ts"), ["./product-values"], "product-entitlement imports only ./product-values");
for (const p of ["lib/product-values.ts", "lib/product-entitlement.ts"]) {
  const src = readFileSync(p, "utf8");
  assert.ok(!/server-only|@\/lib\/db|drizzle/.test(src), `${p} stays client-safe`);
}

console.log(`product-entitlement: ${cases.length} cases ok`);
