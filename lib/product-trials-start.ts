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
import { TRIAL_CAPS_ENFORCED } from "@/lib/product-trial-caps";
import { trialStartDecision, type TrialStartRefusal } from "@/lib/product-trial-decision";
import { productTrialWindow, type ProductTrialRow, type TrialCaps } from "@/lib/product-trials";
import type { Product } from "@/lib/product-values";

type Env = Record<string, string | undefined>;

export type StartTrialResult =
  | { ok: true; trial: ProductTrialRow }
  | { ok: false; code: TrialStartRefusal };

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
 * already owns (without trials), or one already trialled. The refusals are
 * lib/product-trial-decision.ts trialStartDecision, the same decision
 * accountProducts(userId).trials[entry].startable reads; the unique index
 * still settles a race (the loser reads "trial_used").
 */
export async function startProductTrial(
  userId: string,
  product: Product,
  opts: { env?: Env; now?: Date; caps?: TrialCaps } = {},
): Promise<StartTrialResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const caps = opts.caps ?? TRIAL_CAPS_ENFORCED;
  const [u] = await db
    .select({ subscriptionPlan: users.subscriptionPlan, subscriptionStatus: users.subscriptionStatus, products: users.products })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const trialled = u
    ? (await db.select({ product: accountProductTrials.product }).from(accountProductTrials).where(eq(accountProductTrials.userId, userId))).map((r) => r.product)
    : [];
  const decision = trialStartDecision(product, u ? { ...u, trialledProducts: trialled } : null, env, caps);
  if (!decision.ok) return decision;
  const row = await insertProductTrial(userId, product, now);
  return row ? { ok: true, trial: row } : { ok: false, code: "trial_used" };
}
