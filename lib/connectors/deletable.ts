// Which connector cards may be deleted (C1b). Pure, client-safe (imports only
// the pure entitlement rules).
//
// ONE rule:
//   - the derived legacy card is NEVER deletable (it has no row to delete);
//   - the FIRST connector (index 0 of the page's list, which the loader
//     orders by created_at, id: the oldest row, or the derived legacy card)
//     is NOT deletable while the connect product is active;
//   - every other connector is deletable.
//
// "The connect product is active" (connectProductActive):
//   subscription status is active, trialing or trial_paused (lib/trial.ts's
//   trial statuses + a paid subscription), AND the account is entitled to the
//   connect entry (lib/product-entitlement.ts entitledProducts, including an
//   ACTIVE per-product trial of connect), OR its entitlement is still
//   "grandfathered" (no valid users.products record: every such account can
//   use its client agent today, so it counts as entitled to connect).
// Anything else (expired, canceled, unpaid, a products record without
// connect) → not active → the first connector is deletable too.

import { entitledProducts, type EntitlementInput } from "../product-entitlement";
import type { ConnectorView } from "./types";

const ACTIVE_STATUSES: readonly string[] = ["active", "trialing", "trial_paused"];

export function connectProductActive(input: EntitlementInput): boolean {
  if (input.subscriptionStatus === null || !ACTIVE_STATUSES.includes(input.subscriptionStatus)) return false;
  const e = entitledProducts(input);
  return e.source === "grandfathered" || e.entries.includes("connect");
}

export function connectorDeletable(args: { derived: boolean; index: number; productActive: boolean }): boolean {
  if (args.derived) return false;
  return !(args.index === 0 && args.productActive);
}

/** A card before the deletable flag is set (what the row / legacy views build). */
export type ConnectorCard = Omit<ConnectorView, "deletable">;

/** The cards, in the page's order (oldest first), with `deletable` set by the rule above. */
export function withDeletable(cards: ConnectorCard[], productActive: boolean): ConnectorView[] {
  return cards.map((c, index) => ({ ...c, deletable: connectorDeletable({ derived: c.derived, index, productActive }) }));
}
