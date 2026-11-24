// trialStartDecision (lib/product-trial-decision.ts): the ONE decision behind
// the trial POST and accountProducts(userId).trials[entry].startable. A full
// table: every entry × flag state × cap state × owned × used, against an
// oracle written out by hand; the refusal order; and source guards that both
// callers go through it (so they cannot disagree).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TRIAL_PRODUCT_OF_ENTRY, trialStartDecision, type TrialStartAccount } from "../../lib/product-trial-decision";
import { TRIAL_CAPS_ENFORCED } from "../../lib/product-trial-caps";
import type { TrialCaps } from "../../lib/product-trials";
import { PRODUCTS, PRODUCT_ENTRIES, type Product, type ProductEntry } from "../../lib/product-values";

// ── The entry → product mapping ───────────────────────────────────────────
assert.deepEqual(TRIAL_PRODUCT_OF_ENTRY, { reception: "reception", sales: "sales", connect: "connect" });

// ── Fixtures ──────────────────────────────────────────────────────────────
const ENVS: Array<Record<string, string | undefined>> = [
  {},
  { CAMPAIGN_DISPATCH: "on" },
  { CAMPAIGN_DISPATCH: "dry" },
  { CLIENT_AGENT: "all" },
  { CLIENT_AGENT: "admin" },
  { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" },
];
// Hand-written flag oracle (no flag = on).
const flagOn = (p: Product, env: Record<string, string | undefined>) =>
  p === "sales" ? env.CAMPAIGN_DISPATCH === "on" : p === "connect" ? env.CLIENT_AGENT === "all" : true;

const capsAll = (v: boolean): TrialCaps => ({ reception: v, reception_multi: v, sales: v, connect: v });
const CAPS: TrialCaps[] = [capsAll(false), capsAll(true), TRIAL_CAPS_ENFORCED, { ...capsAll(false), connect: true }];

// Accounts with the entries they OWN (hand-written; entitlement without trials).
const ACCOUNTS: Array<[string, Omit<TrialStartAccount, "trialledProducts">, ProductEntry[]]> = [
  ["grandfathered premium", { subscriptionPlan: "premium", subscriptionStatus: "active", products: null }, ["reception", "sales"]],
  ["grandfathered global", { subscriptionPlan: "global", subscriptionStatus: "active", products: null }, ["reception"]],
  ["sign-up trialing", { subscriptionPlan: "premium", subscriptionStatus: "trialing", products: null }, ["reception"]],
  ["record multi", { subscriptionPlan: "premium", subscriptionStatus: "active", products: { base: "reception_multi", addons: [] } }, ["reception"]],
  ["record multi + sales", { subscriptionPlan: "premium", subscriptionStatus: "active", products: { base: "reception_multi", addons: ["sales"] } }, ["reception", "sales"]],
  ["record connect only", { subscriptionPlan: null, subscriptionStatus: null, products: { base: "connect", addons: [] } }, ["connect"]],
  ["record sales only", { subscriptionPlan: null, subscriptionStatus: null, products: { base: "sales", addons: [] } }, ["sales"]],
];
const USED: string[][] = [[], ["sales"], ["connect"], ["reception"], ["reception_multi"], [...PRODUCTS]];

// ── The table ─────────────────────────────────────────────────────────────
let n = 0;
let oks = 0;
for (const env of ENVS)
  for (const caps of CAPS)
    for (const [name, acc, owned] of ACCOUNTS)
      for (const used of USED)
        for (const product of PRODUCTS) {
          const d = trialStartDecision(product, { ...acc, trialledProducts: used }, env, caps);
          const entry: ProductEntry = product === "reception_multi" ? "reception" : product;
          const want = !(flagOn(product, env) && caps[product])
            ? "product_unavailable"
            : owned.includes(entry)
              ? "product_owned"
              : used.includes(product)
                ? "trial_used"
                : "ok";
          const got = d.ok ? "ok" : d.code;
          assert.equal(got, want, `${product} / ${name} / used ${JSON.stringify(used)} / env ${JSON.stringify(env)} / caps ${JSON.stringify(caps)}`);
          n++;
          if (d.ok) oks++;
        }
assert.ok(oks > 0, "the table reaches an accepted start");
console.log(`ok: trialStartDecision table, ${n} cases (${oks} accepted)`);

// Unknown account: unavailable first, then account_not_found.
for (const env of ENVS)
  for (const caps of CAPS)
    for (const product of PRODUCTS) {
      const d = trialStartDecision(product, null, env, caps);
      assert.deepEqual(d, { ok: false, code: flagOn(product, env) && caps[product] ? "account_not_found" : "product_unavailable" });
    }

// Today (enforced caps): only sales, only with CAMPAIGN_DISPATCH=on, only when not owned and never trialled.
const fresh: TrialStartAccount = { subscriptionPlan: "premium", subscriptionStatus: "trialing", products: { base: "reception_multi", addons: [] }, trialledProducts: [] };
for (const e of PRODUCT_ENTRIES) {
  const all = { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" };
  assert.equal(trialStartDecision(TRIAL_PRODUCT_OF_ENTRY[e], fresh, all, TRIAL_CAPS_ENFORCED).ok, e === "sales", `today ${e}`);
}
console.log("ok: unknown account order; today only sales is startable");

// ── Source guards: both callers go through the one decision ──────────────
const start = readFileSync(new URL("../../lib/product-trials-start.ts", import.meta.url), "utf8");
const products = readFileSync(new URL("../../lib/products.ts", import.meta.url), "utf8");
assert.match(start, /trialStartDecision\(product,/, "startProductTrial calls trialStartDecision");
assert.doesNotMatch(start, /productTrialStartable|entitledProducts/, "startProductTrial has no second copy of the rules");
assert.match(products, /trialStartDecision\(TRIAL_PRODUCT_OF_ENTRY\[e\]/, "accountProducts calls trialStartDecision per entry");
console.log("ok: the POST and accountProducts share trialStartDecision");
