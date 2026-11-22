// SERVER-ONLY: the product gates of lib/product-menu.ts, read where they are
// computed today. Only the resulting booleans (and the menu built from them)
// reach the browser; no env var name or value does.
//
//   sales   = campaign dispatch is on (CAMPAIGN_DISPATCH, lib/campaigns/
//             dispatch-mode.ts) AND the account may use the outbound call
//             centre (lib/outbound-access.ts: admin, or the plan feature);
//   connect = "Ask your agent" is on for the account (CLIENT_AGENT,
//             lib/tools/client-agent-switch.ts).

import { dispatchMode } from "@/lib/campaigns/dispatch-mode";
import { canUseOutboundCampaigns } from "@/lib/outbound-access";
import type { PlanFeatures } from "@/lib/plan-features";
import { productMenu, type ProductGates, type ProductMenu } from "@/lib/product-menu";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

export function productGates(
  accountIsAdmin: boolean,
  features: Partial<PlanFeatures> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): ProductGates {
  return {
    sales: dispatchMode(env) === "on" && canUseOutboundCampaigns(accountIsAdmin, features),
    connect: clientAgentEnabled(clientAgentMode(env), accountIsAdmin),
  };
}

/**
 * The menu of ONE account (the signed-in user, or the tenant an admin is
 * viewing): its own role, plan, status and features. users.products does not
 * exist yet (P1): null until the column lands.
 */
export function accountProductMenu(
  account: { role: string | null; subscriptionPlan: string | null; subscriptionStatus: string | null } | null | undefined,
  features: Partial<PlanFeatures> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): ProductMenu {
  const isAdmin = account?.role === "admin";
  return productMenu({
    subscriptionPlan: account?.subscriptionPlan ?? null,
    subscriptionStatus: account?.subscriptionStatus ?? null,
    products: null,
    gates: productGates(isAdmin, features, env),
    isAdmin,
  });
}
