// What the dashboard menu shows for each product entry: OWNED or PREVIEW.
// PURE and client-safe: it imports only the pure product modules (types and
// values), and it never reads an env var or the database. Its inputs are
// SERVER results: the account's entitlement (lib/products.ts
// accountProducts(userId), which reads users.products) and the product gates
// (lib/product-gates.ts), computed in the server layouts.
//
//   owned   = the account is entitled to the entry AND the entry's gate is
//             on for this account;
//   preview = anything else, with a call to action:
//             "soon" while the product can't be used yet (its gate is off),
//             "try"  once it can (gate on, not entitled).
// Reception has no gate (always usable). Admins see every entry as owned.
//
// The menu only decides what is SHOWN: every page keeps its own server gate.
// scripts/tests/product-menu.test.ts pins the whole table.

import type { Entitlement } from "./product-entitlement";
import { PRODUCT_ENTRIES, type ProductEntry } from "./product-values";

/** Whether each gated product can be used by this account right now. */
export type ProductGates = { sales: boolean; connect: boolean };

export type ProductCta = "soon" | "try";

export type ProductEntryState = { state: "owned" } | { state: "preview"; cta: ProductCta };

export type ProductMenu = Readonly<Record<ProductEntry, ProductEntryState>>;

export type ProductMenuInput = {
  /** The account's entitlement (only its entries are read). */
  entitlement: Pick<Entitlement, "entries">;
  gates: ProductGates;
  /** The account itself is an admin (its own dashboard): everything owned. */
  isAdmin: boolean;
};

function gateOf(entry: ProductEntry, gates: ProductGates): boolean {
  return entry === "reception" ? true : gates[entry];
}

export function productMenu(input: ProductMenuInput): ProductMenu {
  const entitled = input.entitlement.entries;
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

/**
 * Whether the menu shows this entry as OWNED. "Prévenez-moi" refuses only
 * these (409 product_owned): an entitled entry whose gate is off is still a
 * "soon" preview, so asking to be told is accepted.
 */
export function shownAsOwned(menu: ProductMenu, entry: ProductEntry): boolean {
  return menu[entry].state === "owned";
}
