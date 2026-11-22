// Which products an account is entitled to: a PURE function (client-safe,
// imports only ./product-values). The rules, in order:
//   1. a VALID users.products record → exactly that ("products");
//   2. a trial (trialing / trial_paused) → reception_multi;
//   3. plan "global" or "whatsapp" → reception;
//   4. anything else (premium, legacy "essential", unknown, null) →
//      reception_multi + sales.
// Rules 2-4 are "grandfathered": they reproduce what each existing account
// can use today, so a NULL record changes nothing.

import { PRODUCT_ENTRIES, PRODUCTS, entryOf, type AccountProductsRecord, type Product, type ProductEntry } from "./product-values";

export type EntitlementInput = {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  products: unknown;
};

export type Entitlement = {
  base: Product | null;
  addons: Product[];
  entries: ProductEntry[];
  source: "products" | "grandfathered";
};

const TRIAL_STATUSES: readonly string[] = ["trialing", "trial_paused"];
const RECEPTION_PLANS: readonly string[] = ["global", "whatsapp"];

function isProduct(x: unknown): x is Product {
  return typeof x === "string" && (PRODUCTS as readonly string[]).includes(x);
}

/**
 * A strictly validated users.products record, or null. Valid = a plain
 * object with exactly the keys base and addons, base a known product, addons
 * an array of known products. Add-ons are deduplicated and the base is
 * dropped from them (keeping the first occurrence order).
 */
export function parseProductsRecord(x: unknown): AccountProductsRecord | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const keys = Object.keys(x).sort();
  if (keys.length !== 2 || keys[0] !== "addons" || keys[1] !== "base") return null;
  const { base, addons } = x as { base: unknown; addons: unknown };
  if (!isProduct(base)) return null;
  if (!Array.isArray(addons) || !addons.every(isProduct)) return null;
  const out: Product[] = [];
  for (const a of addons as Product[]) if (a !== base && !out.includes(a)) out.push(a);
  return { base, addons: out };
}

function entriesOf(base: Product | null, addons: Product[]): ProductEntry[] {
  const set = new Set<ProductEntry>();
  if (base) set.add(entryOf(base));
  for (const a of addons) set.add(entryOf(a));
  return PRODUCT_ENTRIES.filter((e) => set.has(e));
}

export function entitledProducts(input: EntitlementInput): Entitlement {
  const record = parseProductsRecord(input.products);
  let base: Product;
  let addons: Product[];
  let source: Entitlement["source"] = "grandfathered";
  if (record) {
    ({ base, addons } = record);
    source = "products";
  } else if (input.subscriptionStatus !== null && TRIAL_STATUSES.includes(input.subscriptionStatus)) {
    base = "reception_multi";
    addons = [];
  } else if (input.subscriptionPlan !== null && RECEPTION_PLANS.includes(input.subscriptionPlan)) {
    base = "reception";
    addons = [];
  } else {
    base = "reception_multi";
    addons = ["sales"];
  }
  return { base, addons, entries: entriesOf(base, addons), source };
}
