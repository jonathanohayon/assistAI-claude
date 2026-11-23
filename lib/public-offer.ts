// What the PUBLIC pricing response says about this deployment's offer, for a
// visitor (no account): which grid the landing shows and which products a NEW
// account could buy and use today. SERVER-ONLY: it reads the deployment's
// switches, and only their resulting VALUES leave this file (no switch or
// variable name is ever put in the response). The public client parsers live
// in lib/public-plan-pricing.ts, which stays free of this import.

import { productPurchasable } from "./order-lines";
import { productOrdersMode } from "./product-orders-switch";
import type { PublicAvailability, PublicGrid } from "./public-plan-pricing";

export type PublicOffer = { grid: PublicGrid; available: PublicAvailability };

/** "products" only when multi-line product orders are open to every account;
 *  admin-only, off, unset or garbage → "legacy" (a visitor is never admin). */
export function publicGrid(env: Record<string, string | undefined>): PublicGrid {
  return productOrdersMode(env) === "on" ? "products" : "legacy";
}

/** The payment route's own rule (productPurchasable), with no account input:
 *  a visitor has none. */
export function publicAvailability(env: Record<string, string | undefined>): PublicAvailability {
  return { sales: productPurchasable("sales", env), connect: productPurchasable("connect", env) };
}

/**
 * The "prévenez-moi" record a NEW account gets at creation from its sign-up
 * door, or null: sales / connect only, and only while that product is not
 * usable (the same `available` the public sign-up page reads, so its "you
 * will be told first" promise and this record agree). reception → none.
 */
export function signupDoorNotify(door: string | null, available: PublicAvailability): "sales" | "connect" | null {
  if (door === "sales") return available.sales ? null : "sales";
  if (door === "connect") return available.connect ? null : "connect";
  return null;
}

export function publicOffer(env: Record<string, string | undefined> = process.env): PublicOffer {
  return { grid: publicGrid(env), available: publicAvailability(env) };
}
