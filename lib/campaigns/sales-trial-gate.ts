// The DB side of the sales trial cap (lib/campaigns/sales-trial-cap.ts) —
// SERVER-ONLY. Called by the dispatcher before each dial, at most once per
// account per tick. Reads: the account's entitlement columns, its sales
// trial row and, ONLY when that row decides, the outbound seconds since the
// trial started. An account with no sales trial row costs one indexed read
// and is never refused.

import { and, eq, gte, sql } from "drizzle-orm";

import { salesTrialRefusal, type SalesTrialRefusal } from "@/lib/campaigns/sales-trial-cap";
import { db } from "@/lib/db";
import { accountProductTrials, campaignCalls, users } from "@/lib/db/schema";
import { entitledProducts } from "@/lib/product-entitlement";

export async function salesTrialGate(userId: string, now: Date = new Date()): Promise<SalesTrialRefusal | null> {
  const [trial] = await db
    .select({
      startedAt: accountProductTrials.startedAt,
      endsAt: accountProductTrials.endsAt,
      minutesIncluded: accountProductTrials.minutesIncluded,
    })
    .from(accountProductTrials)
    .where(and(eq(accountProductTrials.userId, userId), eq(accountProductTrials.product, "sales")))
    .limit(1);
  if (!trial) return null;
  const [u] = await db
    .select({ subscriptionPlan: users.subscriptionPlan, subscriptionStatus: users.subscriptionStatus, products: users.products })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Entitled WITHOUT trials: a paid record or the grandfathered rule.
  if (u && entitledProducts(u).entries.includes("sales")) return null;
  const [used] = await db
    .select({ seconds: sql<number>`coalesce(sum(${campaignCalls.durationSeconds}), 0)::int` })
    .from(campaignCalls)
    .where(and(eq(campaignCalls.userId, userId), gte(campaignCalls.createdAt, trial.startedAt)));
  return salesTrialRefusal({
    salesEntitledWithoutTrial: false,
    trial,
    usedSeconds: Number(used?.seconds ?? 0),
    now,
  });
}
