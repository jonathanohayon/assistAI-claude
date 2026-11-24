// Connector entitlement (B1): how many connectors an account may have and
// whether it may add one now. Pure, no I/O.
//
//   - in trial (the sign-up trial gate, lib/trial.ts signupTrialGateApplies:
//     trialing or trial_paused, non-admin) → limits.trial (default 1);
//   - otherwise → limits.paid (default 5). Paid extras' quantity arrives in B6.
//   - always clamped to HARD_MAX_CONNECTORS (10), whatever the limits say.
//
// canAddConnector, in order:
//   count >= max         → "trial_limit" in trial, else "max_reached";
//   paid account adding a connector beyond the first one included in the
//   product (count >= 1) while multi-line orders are closed for it
//   (PRODUCT_ORDERS, lib/product-orders-switch.ts) → "orders_closed"
//   (the page shows "Bientôt"); a paid extra cannot be bought yet;
//   else ok.
// TODO(B6): extras bought → max = included + extras; the purchase path.

import { HARD_MAX_CONNECTORS, clampConnectorLimit, type ConnectorLimits } from "./limits";
import type { CanAddConnectorReason } from "./types";
import { productOrdersAllowed, productOrdersMode } from "../product-orders-switch";
import { signupTrialGateApplies } from "../trial";

export type ConnectorAccount = { subscriptionStatus: string; role: string | null };

export function connectorsInTrial(account: ConnectorAccount): boolean {
  return signupTrialGateApplies(account);
}

export function maxConnectors(account: ConnectorAccount, limits: ConnectorLimits): number {
  const raw = connectorsInTrial(account) ? limits.trial : limits.paid;
  return Math.min(clampConnectorLimit(raw), HARD_MAX_CONNECTORS);
}

export type CanAddConnector = { ok: boolean; reason?: CanAddConnectorReason };

/**
 * `count` = the connectors the account already has (the derived legacy card
 * counts as one: it occupies the slot its first edit will turn into a row).
 */
export function canAddConnector(
  account: ConnectorAccount,
  count: number,
  limits: ConnectorLimits,
  env: Record<string, string | undefined> = process.env,
): CanAddConnector {
  const inTrial = connectorsInTrial(account);
  if (count >= maxConnectors(account, limits)) return { ok: false, reason: inTrial ? "trial_limit" : "max_reached" };
  if (!inTrial && count >= 1 && !productOrdersAllowed(productOrdersMode(env), account.role === "admin")) {
    return { ok: false, reason: "orders_closed" };
  }
  return { ok: true };
}
