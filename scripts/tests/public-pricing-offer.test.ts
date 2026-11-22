// GET /api/public/plan-pricing gains two ADDITIVE trailing fields computed
// server-side: `grid` ("legacy" | "products") and `available` ({ sales,
// connect }), the payment route's own purchasable rule with no account input.
// Values only: no switch or variable name reaches the body. Mock data only.
// Run with:  npx tsx scripts/tests/public-pricing-offer.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { productPurchasable } from "../../lib/order-lines";
import { DEFAULT_PLAN_PRICING, type PlanPricingMap } from "../../lib/plan-pricing";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { publicAvailability, publicGrid, publicOffer } from "../../lib/public-offer";
import {
  PUBLIC_PLAN_PRICING_CACHE_CONTROL,
  parsePublicAvailability,
  parsePublicGrid,
  parsePublicOffer,
  parsePublicPlanPricing,
  parsePublicProducts,
  publicPlanPricingResponse,
} from "../../lib/public-plan-pricing";

const ROOT = new URL("../../", import.meta.url).pathname;
const ENV_NAMES = ["PRODUCT_ORDERS", "CAMPAIGN_DISPATCH", "CLIENT_AGENT"] as const;
const PLANS_MAP: PlanPricingMap = structuredClone(DEFAULT_PLAN_PRICING);
const CAT = structuredClone(DEFAULT_PRODUCT_CATALOGUE);

async function main() {
  // --- The grid table ----------------------------------------------------
  const gridTable: [string | undefined, "legacy" | "products"][] = [
    [undefined, "legacy"],
    ["", "legacy"],
    ["off", "legacy"],
    ["admin", "legacy"],
    [" ADMIN ", "legacy"],
    ["on", "products"],
    [" On ", "products"],
    ["yes", "legacy"],
    ["true", "legacy"],
    ["all", "legacy"],
  ];
  for (const [v, want] of gridTable) {
    assert.equal(publicGrid({ PRODUCT_ORDERS: v }), want, `grid for ${JSON.stringify(v)}`);
  }
  assert.equal(publicGrid({}), "legacy", "grid with nothing set");

  // --- Available: every flag combo, equal to productPurchasable -----------
  const dispatchValues = [undefined, "", "off", "dry", "on", " ON ", "garbage"];
  const clientAgentValues = [undefined, "", "off", "admin", "all", " ALL ", "garbage"];
  for (const d of dispatchValues) {
    for (const c of clientAgentValues) {
      const env = { CAMPAIGN_DISPATCH: d, CLIENT_AGENT: c };
      const got = publicAvailability(env);
      assert.deepEqual(
        got,
        { sales: productPurchasable("sales", env), connect: productPurchasable("connect", env) },
        `available matches productPurchasable for ${JSON.stringify(env)}`,
      );
      assert.equal(got.sales, (d ?? "").trim().toLowerCase() === "on", `sales for ${JSON.stringify(d)}`);
      assert.equal(got.connect, (c ?? "").trim().toLowerCase() === "all", `connect for ${JSON.stringify(c)}`);
    }
  }
  // The grid does not depend on the product switches, nor available on the grid switch.
  assert.deepEqual(publicOffer({ PRODUCT_ORDERS: "on" }), {
    grid: "products",
    available: { sales: false, connect: false },
  });
  assert.deepEqual(publicOffer({ CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }), {
    grid: "legacy",
    available: { sales: true, connect: true },
  });

  // --- Additivity ---------------------------------------------------------
  const before = await publicPlanPricingResponse(async () => PLANS_MAP, async () => CAT);
  const beforeText = await before.text();
  const envs: Record<string, string | undefined>[] = [
    {},
    { PRODUCT_ORDERS: "on", CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" },
    { PRODUCT_ORDERS: "admin", CAMPAIGN_DISPATCH: "dry", CLIENT_AGENT: "admin" },
  ];
  for (const env of envs) {
    const res = await publicPlanPricingResponse(async () => PLANS_MAP, async () => CAT, () => publicOffer(env));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), PUBLIC_PLAN_PRICING_CACHE_CONTROL, "CDN caching kept");
    const text = await res.text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed),
      [...Object.keys(JSON.parse(beforeText)), "grid", "available"],
      "grid and available are two new, trailing keys",
    );
    const { grid, available, ...rest } = parsed;
    assert.equal(JSON.stringify(rest), beforeText, "the response minus the two keys is the old output, byte for byte");
    assert.ok(text.startsWith(beforeText.slice(0, -1) + ',"grid":'), "the bytes before the new fields are unchanged");
    assert.deepEqual({ grid, available }, publicOffer(env));

    // Body guard: values only, no switch name, no internal word.
    for (const name of ENV_NAMES) assert.ok(!text.includes(name), `body never carries ${name}`);
    assert.doesNotMatch(text, /dispatch|client_agent|product_orders|admin/i, "no internal word in the body");

    // Clients: the older parsers still read; the new parsers are strict.
    assert.deepEqual(parsePublicPlanPricing(parsed), PLANS_MAP);
    assert.deepEqual(parsePublicProducts(parsed), CAT);
    assert.equal(parsePublicGrid(parsed), grid);
    assert.deepEqual(parsePublicAvailability(parsed), available);
    assert.deepEqual(parsePublicOffer(parsed), { grid, available });
  }

  // A producer returning extra keys never leaks them.
  {
    const leaky = () => ({ ...publicOffer({}), PRODUCT_ORDERS: "on" }) as unknown as ReturnType<typeof publicOffer>;
    const leakyAvail = () =>
      ({ grid: "legacy", available: { sales: false, connect: false, CLIENT_AGENT: "all" } }) as unknown as ReturnType<
        typeof publicOffer
      >;
    for (const offer of [leaky, leakyAvail]) {
      const text = await (await publicPlanPricingResponse(async () => PLANS_MAP, undefined, offer)).text();
      for (const name of ENV_NAMES) assert.ok(!text.includes(name), `picked fields only (${name})`);
    }
  }

  // Older server (no new fields) → null, the caller keeps the legacy grid.
  const old = JSON.parse(beforeText);
  assert.equal(parsePublicGrid(old), null);
  assert.equal(parsePublicAvailability(old), null);
  assert.equal(parsePublicOffer(old), null);
  // Bad values → null.
  for (const g of ["admin", "on", "", 1, null, ["legacy"]]) assert.equal(parsePublicGrid({ grid: g }), null, `grid ${JSON.stringify(g)}`);
  for (const a of [
    null,
    [],
    { sales: true },
    { connect: true },
    { sales: "true", connect: false },
    { sales: 1, connect: 0 },
  ]) {
    assert.equal(parsePublicAvailability({ available: a }), null, `available ${JSON.stringify(a)}`);
  }
  assert.equal(parsePublicOffer({ grid: "products" }), null, "both fields required for parsePublicOffer");
  assert.equal(parsePublicGrid(null), null);
  assert.equal(parsePublicAvailability(undefined), null);

  // A failed load stays the uncached 503 with no offer either.
  const failed = await publicPlanPricingResponse(
    async () => Promise.reject(new Error("db down")),
    async () => CAT,
    () => publicOffer({ PRODUCT_ORDERS: "on" }),
  );
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "pricing_unavailable" });

  // --- Source guard -------------------------------------------------------
  // The route and the client-safe module never name a switch; only
  // lib/public-offer.ts reads them, through the shared mode helpers.
  const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
  for (const p of ["app/api/public/plan-pricing/route.ts", "lib/public-plan-pricing.ts", "lib/public-offer.ts"]) {
    const code = src(p);
    for (const name of ENV_NAMES) assert.ok(!code.includes(name), `${p} never names ${name}`);
    assert.ok(!/process\.env\.[A-Z_]+/.test(code), `${p} reads no named env var`);
  }
  // The client-safe module does not pull in the server-side offer.
  assert.doesNotMatch(src("lib/public-plan-pricing.ts"), /from "\.\/public-offer"|from "@\/lib\/public-offer"|order-lines|product-orders-switch/);

  console.log("ALL PUBLIC-PRICING-OFFER TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
