// Per-product usage over real rows — SERVER-ONLY (lib/db). The pure
// computation is lib/usage-by-product.ts; this only reads the period's
// calls (duration + product) and campaign_calls (duration), with the SAME
// bounds as billing-stats (created_at >= start AND <= end).
// Read only for accounts with a products record: billing-stats never calls
// it for a grandfathered account (its response stays byte-identical).

import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls, campaignCalls } from "@/lib/db/schema";
import type { CatalogueCurrency } from "@/lib/product-catalogue";
import type { Entitlement } from "@/lib/product-entitlement";
import { trialUsage } from "@/lib/product-trials";
import { getProductCatalogue, loadProductTrials } from "@/lib/products";
import { usageByProduct, type UsageByProduct } from "@/lib/usage-by-product";

export async function accountUsageByProduct(opts: {
  userId: string;
  window: { start: Date; end: Date };
  entitlement: Entitlement;
  currency: CatalogueCurrency;
  planMinutes: number;
  planOverage: number;
  now?: Date;
}): Promise<UsageByProduct> {
  const { userId, window } = opts;
  const callRows = await db
    .select({ durationSeconds: calls.durationSeconds, product: calls.product, createdAt: calls.createdAt })
    .from(calls)
    .where(and(eq(calls.userId, userId), gte(calls.createdAt, window.start), lte(calls.createdAt, window.end)));
  const campaignRows = await db
    .select({ durationSeconds: campaignCalls.durationSeconds, createdAt: campaignCalls.createdAt })
    .from(campaignCalls)
    .where(and(eq(campaignCalls.userId, userId), gte(campaignCalls.createdAt, window.start), lte(campaignCalls.createdAt, window.end)));
  const usage = usageByProduct({
    calls: callRows,
    campaignCalls: campaignRows,
    window,
    entitlement: opts.entitlement,
    catalogue: await getProductCatalogue(),
    currency: opts.currency,
    planMinutes: opts.planMinutes,
    planOverage: opts.planOverage,
  });
  // P3, additive: per-product trials (minutes included / used since each
  // trial started). No trial row = no extra read beyond the rows lookup and
  // no `trials` key, so the response is unchanged for such an account.
  // Informative only: nothing here refuses a call.
  const trialRows = await loadProductTrials(userId);
  if (usage.kind !== "products" || trialRows.length === 0) return usage;
  const since = new Date(Math.min(...trialRows.map((r) => r.startedAt.getTime())));
  const trialCalls = await db
    .select({ durationSeconds: calls.durationSeconds, product: calls.product, createdAt: calls.createdAt })
    .from(calls)
    .where(and(eq(calls.userId, userId), gte(calls.createdAt, since)));
  const trialCampaignCalls = await db
    .select({ durationSeconds: campaignCalls.durationSeconds, createdAt: campaignCalls.createdAt })
    .from(campaignCalls)
    .where(and(eq(campaignCalls.userId, userId), gte(campaignCalls.createdAt, since)));
  return { ...usage, trials: trialUsage(trialRows, trialCalls, trialCampaignCalls, opts.now ?? new Date()) };
}
