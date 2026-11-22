// SERVER-ONLY: the inputs of lib/product-menu.ts, read where they are
// computed today. Only the resulting menu (owned / preview + CTA) reaches the
// browser; no env var name or value does.
//
//   entitlement = lib/products.ts accountProducts(userId) (reads users.products,
//                 else the grandfathered rules);
//   sales gate  = campaign dispatch is on (CAMPAIGN_DISPATCH, lib/campaigns/
//                 dispatch-mode.ts) AND the account may use the outbound call
//                 centre (lib/outbound-access.ts: admin, or the plan feature);
//   connect gate = "Ask your agent" is on for the account (CLIENT_AGENT,
//                 lib/tools/client-agent-switch.ts).

import { eq } from "drizzle-orm";

import { dispatchMode } from "@/lib/campaigns/dispatch-mode";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { canUseOutboundCampaigns } from "@/lib/outbound-access";
import { featuresForPlan, type PlanFeatures } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import type { Entitlement } from "@/lib/product-entitlement";
import { productMenu, type ProductGates, type ProductMenu } from "@/lib/product-menu";
import { accountProducts } from "@/lib/products";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

type Env = Record<string, string | undefined>;

export function productGates(
  accountIsAdmin: boolean,
  features: Partial<PlanFeatures> | null | undefined,
  env: Env = process.env,
): ProductGates {
  return {
    sales: dispatchMode(env) === "on" && canUseOutboundCampaigns(accountIsAdmin, features),
    connect: clientAgentEnabled(clientAgentMode(env), accountIsAdmin),
  };
}

/** The menu from an entitlement already loaded (pure given `env`; unit-tested). */
export function menuFor(
  entitlement: Pick<Entitlement, "entries">,
  role: string | null | undefined,
  features: Partial<PlanFeatures> | null | undefined,
  env: Env = process.env,
): ProductMenu {
  const isAdmin = role === "admin";
  return productMenu({ entitlement, gates: productGates(isAdmin, features, env), isAdmin });
}

/**
 * The menu of ONE account: the signed-in user, or the TARGET tenant of the
 * admin view (its own id, role and features, never the admin's).
 */
export async function accountProductMenu(
  userId: string,
  role: string | null | undefined,
  features: Partial<PlanFeatures> | null | undefined,
): Promise<ProductMenu> {
  return menuFor(await accountProducts(userId), role, features);
}

/**
 * The menu of an account from its id alone (role and plan features loaded
 * here): what a product page uses to pick its preview header.
 */
export async function loadAccountProductMenu(userId: string): Promise<ProductMenu> {
  const [u] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const features = featuresForPlan(await getPlanFeatureMatrix(), u?.subscriptionPlan);
  return accountProductMenu(userId, u?.role, features);
}
