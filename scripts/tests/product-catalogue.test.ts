// The product catalogue (lib/product-catalogue.ts, lib/products.ts): the VP
// defaults, the strict parser, the stored-row fallback (absent → defaults,
// invalid → defaults + the invalid hook), the admin write helper fed the RAW
// body (partial, omitted = unchanged, invalid → every path named), the
// accountProducts explicit pick, and static guards on the admin route, the
// public route and billing-stats (products only add usageByProduct, P2). Mock data only.
// Run with:  npx tsx scripts/tests/product-catalogue.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_PRODUCT_CATALOGUE,
  PRODUCT_PRICE_FIELDS,
  catalogueMinutes,
  catalogueOverage,
  catalogueWrite,
  defaultProductCatalogue,
  isNullByDesign,
  parseProductCatalogue,
} from "../../lib/product-catalogue";
import { PRODUCTS } from "../../lib/product-values";
import { ACCOUNT_PRODUCTS_PICK, catalogueFromStored, getProductCatalogue } from "../../lib/products";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const clone = <T>(x: T): T => structuredClone(x);

async function main() {
  // ── Defaults = the VP grid ──────────────────────────────────────────────
  const D = DEFAULT_PRODUCT_CATALOGUE;
  const grid: Record<string, { EUR: [number, number | null, number, number]; ILS: [number, number | null, number, number] }> = {
    reception: { EUR: [89, 69, 200, 0.39], ILS: [349, 269, 200, 1.5] },
    reception_multi: { EUR: [169, null, 450, 0.39], ILS: [649, null, 450, 1.5] },
    sales: { EUR: [149, 99, 400, 0.39], ILS: [549, 399, 250, 1.9] },
    connect: { EUR: [49, 39, 100, 0.39], ILS: [199, 149, 100, 1.5] },
  };
  assert.deepEqual(Object.keys(D), [...PRODUCTS]);
  for (const p of PRODUCTS) {
    for (const c of ["EUR", "ILS"] as const) {
      const [monthly, addon, minutes, overage] = grid[p][c];
      assert.deepEqual(
        D[p][c],
        { monthly, annual: monthly * 10, addonMonthly: addon, addonAnnual: addon === null ? null : addon * 10, minutes, overagePerMin: overage },
        `${p} ${c} defaults`,
      );
      assert.equal(catalogueMinutes(D, p, c), minutes);
      assert.equal(catalogueOverage(D, p, c), overage);
    }
  }
  // Only the reception_multi add-on prices are null, by design.
  for (const p of PRODUCTS)
    for (const c of ["EUR", "ILS"] as const)
      for (const f of PRODUCT_PRICE_FIELDS) assert.equal(D[p][c][f] === null, isNullByDesign(p, f), `${p}.${c}.${f} null iff by design`);
  const copy = defaultProductCatalogue();
  copy.reception.EUR.monthly = 1;
  assert.equal(D.reception.EUR.monthly, 89, "defaultProductCatalogue returns a copy");
  console.log("ok: defaults = the VP grid, annual = 10 × monthly");

  // ── Strict parser ───────────────────────────────────────────────────────
  assert.deepEqual(parseProductCatalogue(clone(D)), D);
  assert.deepEqual(parseProductCatalogue(JSON.parse(JSON.stringify(D))), D, "JSON round-trip");
  // Loose view of a catalogue copy, to break it in every way the parser must refuse.
  type Loose = Record<string, Record<string, Record<string, unknown> | unknown[] | null> | null>;
  type LooseRow = Record<string, unknown>;
  const r = (c: Loose, p: string, cur: string) => c[p]![cur] as LooseRow;
  const mutations: Array<[string, (c: Loose) => void]> = [
    ["missing product", (c) => delete c.connect],
    ["unknown product", (c) => (c.gold = clone(c.connect))],
    ["missing currency", (c) => delete c.sales!.ILS],
    ["unknown currency", (c) => (c.sales!.USD = clone(c.sales!.EUR))],
    ["missing field", (c) => delete r(c, "reception", "EUR").minutes],
    ["unknown field", (c) => (r(c, "reception", "EUR").setup = 1)],
    ["negative", (c) => (r(c, "reception", "EUR").monthly = -1)],
    ["NaN", (c) => (r(c, "reception", "EUR").monthly = NaN)],
    ["Infinity", (c) => (r(c, "reception", "ILS").minutes = Infinity)],
    ["string number", (c) => (r(c, "reception", "EUR").monthly = "89")],
    ["null where a number is required", (c) => (r(c, "connect", "ILS").monthly = null)],
    ["null add-on outside reception_multi", (c) => (r(c, "sales", "ILS").addonMonthly = null)],
    ["reception_multi add-on priced", (c) => (r(c, "reception_multi", "EUR").addonMonthly = 10)],
    ["row is an array", (c) => (c.reception!.EUR = [])],
    ["product is null", (c) => (c.reception = null)],
  ];
  for (const [name, mutate] of mutations) {
    const c = clone(D) as unknown as Loose;
    mutate(c);
    assert.equal(parseProductCatalogue(c), null, `parse refuses: ${name}`);
  }
  for (const bad of [null, undefined, "x", 1, [], {}]) assert.equal(parseProductCatalogue(bad), null);
  console.log("ok: strict parser");

  // ── Stored row → catalogue ──────────────────────────────────────────────
  // E2: the stored row also yields its engine overrides (none here).
  const NONE = { reception: null, reception_multi: null, sales: null, connect: null };
  const edited = clone(D);
  edited.sales.EUR.monthly = 159;
  assert.deepEqual(catalogueFromStored(null), { catalogue: D, engineOverrides: NONE, source: "default" });
  assert.deepEqual(catalogueFromStored(JSON.stringify(edited)), { catalogue: edited, engineOverrides: NONE, source: "stored" });
  for (const raw of ["", "{", "null", "[]", JSON.stringify({ ...edited, gold: {} }), JSON.stringify({ reception: D.reception })]) {
    assert.deepEqual(catalogueFromStored(raw), { catalogue: D, engineOverrides: NONE, source: "invalid" }, `invalid row ${raw.slice(0, 30)} → defaults`);
  }
  let alerts = 0;
  const deps = (raw: string | null) => ({ read: async () => raw, onInvalid: () => void alerts++ });
  assert.deepEqual(await getProductCatalogue(deps(null)), D);
  assert.deepEqual(await getProductCatalogue(deps(JSON.stringify(edited))), edited);
  assert.equal(alerts, 0, "absent / valid rows never alert");
  assert.deepEqual(await getProductCatalogue(deps("{not json")), D);
  assert.deepEqual(await getProductCatalogue(deps(JSON.stringify({ reception: 1 }))), D);
  assert.equal(alerts, 2, "an invalid row falls back AND alerts");
  console.log("ok: stored row fallback + alert");

  // ── Admin write helper, fed the raw body ────────────────────────────────
  const stored = edited;
  // Omitted = unchanged (empty body, no catalogue key, empty patch).
  for (const body of [{}, { catalogue: {} }, { catalogue: { sales: {} } }, { catalogue: { sales: { EUR: {} } } }]) {
    assert.deepEqual(catalogueWrite(stored, body), { ok: true, value: stored, changed: false }, `omitted: ${JSON.stringify(body)}`);
  }
  // A partial write changes exactly the fields present.
  {
    const w = catalogueWrite(stored, { catalogue: { connect: { ILS: { monthly: 219, annual: 2190 } } } });
    assert.ok(w.ok && w.changed);
    const want = clone(stored);
    want.connect.ILS.monthly = 219;
    want.connect.ILS.annual = 2190;
    assert.deepEqual(w.ok && w.value, want);
    assert.equal(stored.connect.ILS.monthly, 199, "the stored value is never mutated");
  }
  // An unchanged re-send passes, changed=false.
  assert.deepEqual(catalogueWrite(stored, { catalogue: clone(stored) }), { ok: true, value: stored, changed: false });
  // reception_multi add-on null re-sent is fine.
  assert.deepEqual(catalogueWrite(stored, { catalogue: { reception_multi: { ILS: { addonMonthly: null } } } }), { ok: true, value: stored, changed: false });
  // Invalid → every path named, nothing written.
  assert.deepEqual(
    catalogueWrite(stored, {
      catalogue: {
        gold: {},
        sales: { USD: {}, EUR: { monthly: -1, setup: 3, minutes: 410 } },
        connect: { ILS: { monthly: null } },
        reception_multi: { EUR: { addonMonthly: 5 } },
      },
      extra: 1,
    }),
    {
      ok: false,
      error: "invalid_catalogue",
      fields: [
        "extra",
        "catalogue.gold",
        "catalogue.sales.USD",
        "catalogue.sales.EUR.monthly",
        "catalogue.sales.EUR.setup",
        "catalogue.connect.ILS.monthly",
        "catalogue.reception_multi.EUR.addonMonthly",
      ],
    },
  );
  for (const body of [null, "x", [], 3]) assert.equal(catalogueWrite(stored, body).ok, false, `body ${JSON.stringify(body)} refused`);
  assert.equal(catalogueWrite(stored, { catalogue: "x" }).ok, false);
  // Every accepted write still passes the strict parser.
  {
    const w = catalogueWrite(stored, { catalogue: { reception: { EUR: { overagePerMin: 0 } } } });
    assert.ok(w.ok && parseProductCatalogue(w.value));
  }
  console.log("ok: admin write helper (partial, omitted = unchanged, invalid named)");

  // ── accountProducts: explicit pick of three columns ─────────────────────
  assert.deepEqual(Object.keys(ACCOUNT_PRODUCTS_PICK).sort(), ["products", "subscriptionPlan", "subscriptionStatus"]);
  const prod = code("lib/products.ts");
  assert.match(prod, /db\.select\(ACCOUNT_PRODUCTS_PICK\)\.from\(users\)\.where\(eq\(users\.id, userId\)\)/);
  assert.doesNotMatch(prod, /db\.select\(\)/, "never a whole users row");

  // ── Static guards on the routes ─────────────────────────────────────────
  const admin = code("app/api/admin/product-catalogue/route.ts");
  for (const m of ["GET", "PUT"]) {
    const body = admin.slice(admin.indexOf(`export async function ${m}`));
    const first = body.slice(0, 200);
    assert.match(first, /const guard = await requireAdmin\(\);\s*if \(!guard\.ok\) return guard\.response;/, `${m} is admin-only first`);
  }
  assert.match(admin, /catalogueRowWrite\(stored, body\)/, "PUT goes through the raw-body helper (E2: the row helper, which runs catalogueWrite)");
  assert.match(code("lib/product-catalogue-row.ts"), /catalogueWrite\(stored\.catalogue, priceBody\)/, "prices keep the catalogueWrite rules");
  assert.match(code("app/api/public/plan-pricing/route.ts"), /publicPlanPricingResponse\(getPlanPricingMap, \(\) => getProductCatalogue\(\), \(\) => publicOffer\(\)\)/);
  // P2: billing-stats reads products ONLY to add usageByProduct for a valid
  // record (the bytes are proven in scripts/products-usage-db.sh).
  const bs = code("app/api/dashboard/billing-stats/route.ts");
  assert.doesNotMatch(bs, /product-catalogue|lib\/products"/, "billing-stats never reads the catalogue directly");
  assert.match(bs, /entitlement\.source === "products"\s*\?\s*await accountUsageByProduct\(/, "per-product usage only for a valid record");
  assert.match(bs, /\.\.\.\(usageByProduct \? \{ usageByProduct \} : \{\}\)/, "the field is additive");
  // P3: sign-up writes ONE fixed record (reception_multi, no add-on) for
  // every door, at account creation only (the DB suite proves logins write
  // nothing: scripts/product-trials-db.sh).
  const prov = code("lib/auth/provision-tenant.ts");
  assert.match(prov, /SIGNUP_PRODUCTS: AccountProductsRecord = \{ base: "reception_multi", addons: \[\] \}/, "the sign-up record is reception_multi");
  assert.equal([...prov.matchAll(/products:/g)].length, 1, "users.products written in exactly one place (the insert)");
  assert.doesNotMatch(prov, /\.update\(users\)/, "sign-up never updates an existing users row");

  console.log("ALL PRODUCT-CATALOGUE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
