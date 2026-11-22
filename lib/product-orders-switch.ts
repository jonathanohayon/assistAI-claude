// Site switch for multi-line product orders (P4): env PRODUCT_ORDERS =
//   unset / anything else = "off" (default): a create-payment body with
//     `products` is refused (400 product_orders_disabled) before anything is
//     computed or written, and HYP is never called;
//   "admin": only accounts with role admin may create one (a tenant gets the
//     same 400, no hint);
//   "on": every account, per the purchasable rules (lib/order-lines.ts).
// Same shape as CLIENT_AGENT (lib/tools/client-agent-switch.ts).
// The switch gates CREATION only: the HYP callback activates a paid
// multi-line order whatever the current mode (never strand a paying customer).
// The legacy `{ plan, period, locale }` body is never gated.
export type ProductOrdersMode = "off" | "admin" | "on";

export function productOrdersMode(env: Record<string, string | undefined> = process.env): ProductOrdersMode {
  const v = (env.PRODUCT_ORDERS ?? "").trim().toLowerCase();
  return v === "admin" || v === "on" ? v : "off";
}

/** Whether THIS account may create a multi-line order. */
export function productOrdersAllowed(mode: ProductOrdersMode, accountIsAdmin: boolean): boolean {
  return mode === "on" || (mode === "admin" && accountIsAdmin);
}
