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
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "@/lib/product-trials";
import { accountProducts } from "@/lib/products";
import type { TrialCtaTrial } from "@/lib/trial-cta";
import type { ProductEntry } from "@/lib/product-values";
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

/** The per-product trial terms stated under "Essayer gratuitement" (lib/product-trials.ts). */
export const PRODUCT_TRIAL_TERMS: { days: number; minutes: number } = {
  days: PRODUCT_TRIAL_DAYS,
  minutes: PRODUCT_TRIAL_MINUTES,
};

/** What a product page needs to pick its header: the menu, the notify-me requests, the trials. */
export type ProductPageState = {
  menu: ProductMenu;
  /** The entries the account asked to be told about ("Prévenez-moi"), from accountProducts. */
  notifyRequested: ProductEntry[];
  /**
   * accountProducts.trials, read through the narrow lib/trial-cta.ts type
   * (its `startable` is the BE's start decision; absent = not startable).
   */
  trials: Record<ProductEntry, TrialCtaTrial>;
  trialTerms: { days: number; minutes: number };
};

/**
 * The menu of an account from its id alone (role and plan features loaded
 * here), plus its notify-me requests and per-product trials: what a product page uses to pick its
 * preview header, with ONE accountProducts read and no client fetch.
 */
export async function loadProductPage(userId: string): Promise<ProductPageState> {
  const products = await accountProducts(userId);
  return {
    menu: await menuForAccount(userId, products),
    notifyRequested: products.notifyRequested,
    trials: products.trials,
    trialTerms: PRODUCT_TRIAL_TERMS,
  };
}

/**
 * The menu of an account whose entitlement is already loaded: its OWN role
 * and plan features are read here (for an admin's ?asUserId, the target's,
 * never the admin's), exactly as the dashboard and admin layouts pass them.
 */
export async function menuForAccount(
  userId: string,
  entitlement: Pick<Entitlement, "entries">,
  env: Env = process.env,
): Promise<ProductMenu> {
  const [u] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const features = featuresForPlan(await getPlanFeatureMatrix(), u?.subscriptionPlan);
  return menuFor(entitlement, u?.role, features, env);
}
