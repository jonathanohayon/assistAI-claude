// What the dashboard menu shows for each product entry: OWNED or PREVIEW.
// PURE and client-safe: it imports only the two pure product modules, and
// it never reads an env var. The gates are SERVER inputs: the server layout
// computes them (lib/product-gates.ts) and passes booleans in.
//
//   owned   = the account is entitled to the entry (lib/product-entitlement)
//             AND the entry's gate is on for this account;
//   preview = anything else, with a call to action:
//             "soon" while the product can't be used yet (its gate is off),
//             "try"  once it can (gate on, not entitled).
// Reception has no gate (always usable). Admins see every entry as owned.
//
// The menu only decides what is SHOWN: every page keeps its own server gate.
// scripts/tests/product-menu.test.ts pins the whole table.

import { entitledProducts, type EntitlementInput } from "./product-entitlement";
import { PRODUCT_ENTRIES, type ProductEntry } from "./product-values";

/** Whether each gated product can be used by this account right now. */
export type ProductGates = { sales: boolean; connect: boolean };

export type ProductCta = "soon" | "try";

export type ProductEntryState = { state: "owned" } | { state: "preview"; cta: ProductCta };

export type ProductMenu = Readonly<Record<ProductEntry, ProductEntryState>>;

export type ProductMenuInput = EntitlementInput & {
  gates: ProductGates;
  /** The account itself is an admin (its own dashboard): everything owned. */
  isAdmin: boolean;
};

function gateOf(entry: ProductEntry, gates: ProductGates): boolean {
  return entry === "reception" ? true : gates[entry];
}

export function productMenu(input: ProductMenuInput): ProductMenu {
  const entitled = entitledProducts(input).entries;
  const out = {} as Record<ProductEntry, ProductEntryState>;
  for (const entry of PRODUCT_ENTRIES) {
    const gate = gateOf(entry, input.gates);
    out[entry] =
      input.isAdmin || (entitled.includes(entry) && gate)
        ? { state: "owned" }
        : { state: "preview", cta: gate ? "try" : "soon" };
  }
  return out;
}
