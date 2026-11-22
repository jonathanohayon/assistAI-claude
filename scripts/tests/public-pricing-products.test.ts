// GET /api/public/plan-pricing gains a `products` field (the product
// catalogue) ADDITIVELY: the plan keys keep their exact bytes, the field is
// last, the CDN cache header is unchanged, a failure is still an uncached
// 503 with no price, and the existing client parser still reads the plans.
// Mock data only. Run with:  npx tsx scripts/tests/public-pricing-products.test.ts

import assert from "node:assert/strict";

import { DEFAULT_PLAN_PRICING, PRICE_FIELDS, type PlanPricingMap } from "../../lib/plan-pricing";
import { DEFAULT_PRODUCT_CATALOGUE, type ProductCatalogue } from "../../lib/product-catalogue";
import {
  PUBLIC_PLAN_PRICING_CACHE_CONTROL,
  parsePublicPlanPricing,
  parsePublicProducts,
  publicPlanPricingResponse,
} from "../../lib/public-plan-pricing";

const PLANS_MAP: PlanPricingMap = structuredClone(DEFAULT_PLAN_PRICING);
for (const k of Object.keys(PLANS_MAP) as (keyof PlanPricingMap)[]) for (const f of PRICE_FIELDS) PLANS_MAP[k][f] += 3;
const CAT: ProductCatalogue = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
CAT.sales.ILS.monthly = 579;

async function main() {
  const before = await publicPlanPricingResponse(async () => PLANS_MAP);
  const after = await publicPlanPricingResponse(async () => PLANS_MAP, async () => CAT);
  assert.equal(before.status, 200);
  assert.equal(after.status, 200);
  assert.equal(after.headers.get("cache-control"), PUBLIC_PLAN_PRICING_CACHE_CONTROL, "CDN caching kept");
  assert.equal(after.headers.get("cache-control"), before.headers.get("cache-control"));

  const beforeText = await before.text();
  const afterText = await after.text();
  assert.equal(beforeText, JSON.stringify(PLANS_MAP), "without products: the response is the plan map, as before");
  const parsed = JSON.parse(afterText) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), [...Object.keys(PLANS_MAP), "products"], "products is one new, trailing key");
  const { products, ...rest } = parsed;
  assert.equal(JSON.stringify(rest), beforeText, "the existing keys are byte-identical");
  assert.ok(afterText.startsWith(beforeText.slice(0, -1) + ',"products":'), "the bytes before the new field are unchanged");
  assert.deepEqual(products, CAT);

  // Clients: the existing plan parser is unaffected; the new parser is strict.
  assert.deepEqual(parsePublicPlanPricing(parsed), PLANS_MAP);
  assert.deepEqual(parsePublicPlanPricing(JSON.parse(beforeText)), PLANS_MAP);
  assert.deepEqual(parsePublicProducts(parsed), CAT);
  assert.equal(parsePublicProducts(JSON.parse(beforeText)), null, "no field → null");
  assert.equal(parsePublicProducts({ ...rest, products: { reception: 1 } }), null, "a bad field → null");
  assert.equal(parsePublicProducts(null), null);

  // A failed catalogue load is the same uncached 503 as a failed plan load.
  for (const res of [
    await publicPlanPricingResponse(async () => PLANS_MAP, async () => Promise.reject(new Error("db down"))),
    await publicPlanPricingResponse(async () => Promise.reject(new Error("db down")), async () => CAT),
  ]) {
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { error: "pricing_unavailable" });
  }
  console.log("ALL PUBLIC-PRICING-PRODUCTS TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
