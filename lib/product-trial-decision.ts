// Whether a per-product trial would START (P3), PURE (imports only pure
// product modules). The ONE decision behind both:
//   - POST /api/dashboard/products/trial (lib/product-trials-start.ts
//     startProductTrial), which then inserts the row;
//   - accountProducts(userId).trials[entry].startable (lib/products.ts), so
//     the "Essayer gratuitement" button is shown only when the POST would
//     return 201.
// Refusal order (the POST's): product_unavailable → account_not_found →
// product_owned → trial_used. Table-tested in
// scripts/tests/product-trial-decision.test.ts.
//
// "Owned" is the account's entitlement WITHOUT its active trials (the three
// users columns only), exactly as the POST reads it: an entry entitled only
// by an active trial is refused as trial_used, not product_owned.
// "Used" is a row for that exact product; the POST's insert still relies on
// the unique (user_id, product) index for races (a lost race → trial_used).

import { entitledProducts } from "./product-entitlement";
import { productTrialStartable, type TrialCaps } from "./product-trials";
import { entryOf, type Product, type ProductEntry } from "./product-values";

type Env = Record<string, string | undefined>;

export type TrialStartRefusal = "product_unavailable" | "account_not_found" | "product_owned" | "trial_used";
export type TrialStartDecision = { ok: true } | { ok: false; code: TrialStartRefusal };

/** What the decision reads about the account (null = no such account). */
export type TrialStartAccount = {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  products: unknown;
  /** account_product_trials.product of every row the account has (any state). */
  trialledProducts: readonly string[];
};

/**
 * The product the "Essayer gratuitement" button of each dashboard entry
 * starts. reception → "reception" (reception_multi is a bigger reception,
 * bought, not trialled from the entry).
 */
export const TRIAL_PRODUCT_OF_ENTRY: Readonly<Record<ProductEntry, Product>> = {
  reception: "reception",
  sales: "sales",
  connect: "connect",
};

export function trialStartDecision(
  product: Product,
  account: TrialStartAccount | null,
  env: Env,
  caps: TrialCaps,
): TrialStartDecision {
  if (!productTrialStartable(product, env, caps)) return { ok: false, code: "product_unavailable" };
  if (!account) return { ok: false, code: "account_not_found" };
  const owned = entitledProducts({
    subscriptionPlan: account.subscriptionPlan,
    subscriptionStatus: account.subscriptionStatus,
    products: account.products,
  }).entries;
  if (owned.includes(entryOf(product))) return { ok: false, code: "product_owned" };
  if (account.trialledProducts.includes(product)) return { ok: false, code: "trial_used" };
  return { ok: true };
}
