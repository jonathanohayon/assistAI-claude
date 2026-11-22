// The real effects of the usage-warning runner (lib/usage-warnings.ts) —
// SERVER-ONLY (lib/db, lib/email). The runner gets them injected, so the DB
// suite swaps only `send` (scripts/tests/products-usage-db.test.ts).

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { usageWarnings, users } from "@/lib/db/schema";
import { sendUsageWarningEmail } from "@/lib/email";
import { currencyForLocale } from "@/lib/hyp";
import { logEvent } from "@/lib/logger";
import { entitledProducts } from "@/lib/product-entitlement";
import { DEFAULT_PLAN_KEY, OVERAGE_RATE_ILS_PER_MIN, PLANS, isValidPlanKey } from "@/lib/plans";
import { accountUsageByProduct } from "@/lib/products-usage";
import { usageWindowFor } from "@/lib/monthly-periods";
import { coveragesOf, paidOrderLines } from "@/lib/order-create";
import { currentPeriodWindow } from "@/lib/subscription";
import type { UsageWarningDeps, WarnAccount } from "@/lib/usage-warnings";

/**
 * Candidates: paid (active, with a paid_until: a fixed period), WITH a
 * users.products value. Grandfathered accounts (products NULL) are never
 * read; an invalid record is dropped by the runner's warnableAccount.
 */
type WarnRow = WarnAccount & { subscriptionPeriod: string | null; trialEndsAt: Date | null };

export async function listWarnableAccounts(): Promise<WarnRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      locale: users.locale,
      paidUntil: users.paidUntil,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionPeriod: users.subscriptionPeriod,
      trialEndsAt: users.trialEndsAt,
      products: users.products,
    })
    .from(users)
    .where(and(eq(users.subscriptionStatus, "active"), isNotNull(users.paidUntil), isNotNull(users.products)));
}

export const usageWarningDeps = (over: Partial<UsageWarningDeps> = {}): UsageWarningDeps => ({
  env: process.env,
  now: () => new Date(),
  listAccounts: listWarnableAccounts,
  usageFor: async (a, now) => {
    // The runner hands back the row listAccounts returned.
    const r = a as WarnRow;
    const planKey = isValidPlanKey(r.subscriptionPlan) ? r.subscriptionPlan : DEFAULT_PLAN_KEY;
    const plan = PLANS.find((p) => p.key === planKey) ?? PLANS[0];
    const period = r.subscriptionPeriod === "annual" || r.subscriptionPeriod === "monthly" ? r.subscriptionPeriod : null;
    const paidWindow = currentPeriodWindow(
      {
        subscriptionStatus: r.subscriptionStatus ?? "",
        subscriptionPlan: planKey,
        subscriptionPeriod: period,
        trialEndsAt: r.trialEndsAt ?? null,
        paidUntil: r.paidUntil,
      },
      now,
    );
    // Annual: the current monthly sub-period (the same boundaries as
    // overage billing and billing-stats), so the claim's period_start is that
    // month's start: one warning per threshold per MONTH. Monthly: unchanged
    // (and no extra read).
    const window = usageWindowFor({
      window: paidWindow,
      period,
      coverages: period === "annual" ? coveragesOf(await paidOrderLines(a.id)) : [],
      now,
    });
    const usage = await accountUsageByProduct({
      userId: a.id,
      window,
      entitlement: entitledProducts(a),
      currency: currencyForLocale(a.locale ?? "fr"),
      planMinutes: plan.minutesIncluded,
      planOverage: OVERAGE_RATE_ILS_PER_MIN,
    });
    return { periodStart: window.start, usage };
  },
  claim: async ({ userId, entry, threshold, periodStart }) => {
    const rows = await db
      .insert(usageWarnings)
      .values({ userId, entry, threshold, periodStart })
      .onConflictDoNothing({ target: [usageWarnings.userId, usageWarnings.entry, usageWarnings.threshold, usageWarnings.periodStart] })
      .returning({ id: usageWarnings.id });
    return rows.length === 1;
  },
  send: sendUsageWarningEmail,
  logEvent,
  ...over,
});
