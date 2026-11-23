// Billing page plan cards: only plans the customer can buy (F4).
// Run with:  npx tsx scripts/tests/billing-buyable-plans.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { billingPlanCards } from "../../app/[locale]/dashboard/billing/plan-cards";
import { PLANS, PUBLIC_PLANS, isPublicPlanKey, type PlanKey } from "../../lib/plans";

const keys = (ps: readonly { key: PlanKey }[]) => ps.map((p) => p.key);
const NON_PUBLIC = PLANS.filter((p) => !p.public).map((p) => p.key);

// The test means something only if a non-public plan exists.
assert.ok(NON_PUBLIC.length > 0, "expected at least one non-public plan");

for (const current of keys(PLANS)) {
  const cards = billingPlanCards(current);
  const offered = keys(cards).filter((k) => k !== current);

  // the options offered are exactly the public set minus the current plan
  assert.deepEqual(
    offered,
    keys(PUBLIC_PLANS).filter((k) => k !== current),
    `options for ${current}`,
  );

  // a non-public plan is never offered as a switch
  for (const k of offered) assert.ok(isPublicPlanKey(k), `${current} is offered non-public ${k}`);
  for (const k of NON_PUBLIC) {
    if (k !== current) assert.ok(!keys(cards).includes(k), `${current} sees non-public ${k}`);
  }

  // the current plan is always shown, exactly once (grandfathered included)
  assert.equal(keys(cards).filter((k) => k === current).length, 1, `current ${current} shown once`);
}

// grandfathered account on the legacy plan: its own card plus the public grid, PLANS order
assert.deepEqual(keys(billingPlanCards("whatsapp")), ["global", "premium", "whatsapp"]);
// paid public plan: the public grid only
assert.deepEqual(keys(billingPlanCards("global")), ["global", "premium"]);
assert.deepEqual(keys(billingPlanCards("premium")), ["global", "premium"]);

// ─── source guards ───────────────────────────────────────────────────────────
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cardsSrc = strip(read("app/[locale]/dashboard/billing/plan-cards.ts"));
const page = strip(read("app/[locale]/dashboard/billing/page.tsx"));
const client = strip(read("app/[locale]/dashboard/billing/client.tsx"));

// the cards use the checkout's rule from lib/plans, no list of their own
assert.match(cardsSrc, /from "@\/lib\/plans"/);
assert.match(cardsSrc, /canPurchasePlan\(p\.key, currentPlan\)/);
assert.doesNotMatch(cardsSrc, /"whatsapp"|"global"|"premium"/, "plan-cards must not list plan keys");

// the page passes those cards, never the full PLANS list
assert.match(page, /plans=\{billingPlanCards\(currentPlanKey\)\}/);
assert.doesNotMatch(page, /\bPLANS\b/, "billing page must not read PLANS directly");
// a ?plan= hint is honoured only for a plan the customer can buy
assert.match(page, /canPurchasePlan\(hintedPlan, currentPlanKey\)/);

// the client renders only the `plans` it is given
assert.doesNotMatch(client, /\bPLANS\b|PUBLIC_PLANS/, "billing client must not read a plan list of its own");
assert.match(client, /\{plans\.map\(\(plan\) =>/);

// the checkout uses the same rule (the cards and the payment route agree)
assert.match(
  strip(read("app/api/dashboard/hyp/create-payment/route.ts")),
  /canPurchasePlan\(plan, user\.subscriptionPlan\)/,
);

console.log("billing-buyable-plans: ok");
