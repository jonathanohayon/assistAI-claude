// 2026-11 pricing grid (lib/plans.ts, lib/plan-pricing.ts, lib/plan-features.ts).
// Run with:  npx tsx scripts/tests/pricing-2026-11.test.ts

import assert from "node:assert/strict";

import { DEFAULT_MATRIX, featuresForPlan } from "../../lib/plan-features";
import { DEFAULT_PLAN_PRICING, resolvePrice } from "../../lib/plan-pricing";
import {
  DEFAULT_PLAN_KEY,
  OVERAGE_RATE_ILS_PER_MIN,
  PLANS,
  PUBLIC_PLANS,
  canPurchasePlan,
  isPublicPlanKey,
  isValidPlanKey,
  planByKey,
} from "../../lib/plans";
import { SETTING_KEYS } from "../../lib/settings";

// public grid: 2 plans, in order
assert.deepEqual(PUBLIC_PLANS.map((p) => p.key), ["global", "premium"]);
assert.equal(planByKey("global").name, "Réceptionniste");
assert.equal(planByKey("premium").name, "Clinique / Multi-sites");
assert.equal(planByKey("global").minutesIncluded, 300);
assert.equal(planByKey("premium").minutesIncluded, 800);

// ILS (Israel) and EUR (abroad), monthly and annual (= 10 x monthly)
const P = DEFAULT_PLAN_PRICING;
assert.equal(resolvePrice(P, "global", "monthly", "ILS"), 349);
assert.equal(resolvePrice(P, "premium", "monthly", "ILS"), 649);
assert.equal(resolvePrice(P, "global", "monthly", "EUR"), 89);
assert.equal(resolvePrice(P, "premium", "monthly", "EUR"), 169);
assert.equal(resolvePrice(P, "global", "annual", "ILS"), 3490);
assert.equal(resolvePrice(P, "premium", "annual", "EUR"), 1690);

// Permanence (whatsapp): no longer offered, still valid for existing users
assert.equal(planByKey("whatsapp").public, false);
assert.equal(isPublicPlanKey("whatsapp"), false);
assert.equal(isValidPlanKey("whatsapp"), true);
assert.equal(resolvePrice(P, "whatsapp", "monthly", "ILS"), 199);
assert.equal(PLANS.length, 3); // keys stay: they're stored on users
// unknown / missing plan -> Réceptionniste (no longer the legacy plan)
assert.equal(DEFAULT_PLAN_KEY, "global");
assert.equal(planByKey("does-not-exist").key, "global");

// purchase rule: public plans for anyone, legacy only to renew it
assert.equal(canPurchasePlan("global", null), true);
assert.equal(canPurchasePlan("premium", "whatsapp"), true); // upgrade
assert.equal(canPurchasePlan("whatsapp", "whatsapp"), true); // renewal
assert.equal(canPurchasePlan("whatsapp", "global"), false);
assert.equal(canPurchasePlan("whatsapp", null), false);
assert.equal(canPurchasePlan("bogus", "bogus"), false);

// overage
assert.equal(OVERAGE_RATE_ILS_PER_MIN, 0.9);

// outbound campaigns: in no plan, whatever an older stored matrix says
for (const k of ["global", "premium", "whatsapp", "unknown"]) {
  assert.equal(featuresForPlan(DEFAULT_MATRIX, k).outbound_campaigns, false, k);
}
const oldStored = { ...DEFAULT_MATRIX, premium: { ...DEFAULT_MATRIX.premium, outbound_campaigns: true } };
assert.equal(featuresForPlan(oldStored, "premium").outbound_campaigns, false);
// other premium features unchanged
assert.equal(featuresForPlan(DEFAULT_MATRIX, "premium").calendar, true);

// no outbound / call-centre / transfer promise left in the public copy
const copy = PUBLIC_PLANS.flatMap((p) => [p.name, p.tagline, ...p.features, p.bestFor]).join("\n");
assert.doesNotMatch(copy, /sortant|campagne|centre d'appels|Transfert/i);

// pricing setting moved to v2 so an old admin override can't mask the grid
assert.equal(SETTING_KEYS.PLAN_PRICING, "plan_pricing_v2");

console.log("ALL PRICING-2026-11 TESTS PASSED");
