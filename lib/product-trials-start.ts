// Starting a per-product trial (P3) — SERVER-ONLY (lib/db). Used by
// POST /api/dashboard/products/trial ("Essayer gratuitement") and by
// sign-up (lib/auth/provision-tenant.ts).
//
// The ONE insert: INSERT … ON CONFLICT (user_id, product) DO NOTHING
// RETURNING, so two concurrent starts give exactly one row and the loser
// reads "trial_used". The unique index IS the "once per product" guarantee.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountProductTrials, users } from "@/lib/db/schema";
import { entitledProducts } from "@/lib/product-entitlement";
import { TRIAL_CAPS_ENFORCED } from "@/lib/product-trial-caps";
import { productTrialStartable, productTrialWindow, type ProductTrialRow } from "@/lib/product-trials";
import { entryOf, type Product } from "@/lib/product-values";

type Env = Record<string, string | undefined>;

export type StartTrialResult =
  | { ok: true; trial: ProductTrialRow }
  | { ok: false; code: "product_unavailable" | "product_owned" | "trial_used" | "account_not_found" };

/**
 * Inserts the trial row if none exists for (userId, product). Returns the
 * row, or null when one already existed (the unique index). No other check:
 * callers decide whether the product may be started.
 */
export async function insertProductTrial(userId: string, product: Product, now: Date): Promise<ProductTrialRow | null> {
  const w = productTrialWindow(now);
  const [row] = await db
    .insert(accountProductTrials)
    .values({ userId, product, startedAt: w.startedAt, endsAt: w.endsAt, minutesIncluded: w.minutesIncluded })
    .onConflictDoNothing({ target: [accountProductTrials.userId, accountProductTrials.product] })
    .returning({
      product: accountProductTrials.product,
      startedAt: accountProductTrials.startedAt,
      endsAt: accountProductTrials.endsAt,
      minutesIncluded: accountProductTrials.minutesIncluded,
    });
  return row ?? null;
}

/**
 * "Essayer gratuitement": refused, whatever the client sends, for a product
 * that is not startable (flag off, or its cap not enforced), one the account
 * already owns (without trials), or one already trialled.
 */
export async function startProductTrial(
  userId: string,
  product: Product,
  opts: { env?: Env; now?: Date } = {},
): Promise<StartTrialResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  if (!productTrialStartable(product, env, TRIAL_CAPS_ENFORCED)) return { ok: false, code: "product_unavailable" };
  const [u] = await db
    .select({ subscriptionPlan: users.subscriptionPlan, subscriptionStatus: users.subscriptionStatus, products: users.products })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return { ok: false, code: "account_not_found" };
  if (entitledProducts(u).entries.includes(entryOf(product))) return { ok: false, code: "product_owned" };
  const row = await insertProductTrial(userId, product, now);
  return row ? { ok: true, trial: row } : { ok: false, code: "trial_used" };
}
