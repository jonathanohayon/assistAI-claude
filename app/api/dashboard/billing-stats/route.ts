import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calls, campaignCalls, paymentOrders, users } from "@/lib/db/schema";
import { currencyForLocale } from "@/lib/hyp";
import {
  DEFAULT_PLAN_KEY,
  OVERAGE_RATE_ILS_PER_MIN,
  PLANS,
  isValidPlanKey,
  type PlanKey,
} from "@/lib/plans";
import { catalogueMinutes, catalogueOverage } from "@/lib/product-catalogue";
import { entitledProducts } from "@/lib/product-entitlement";
import { getProductCatalogue } from "@/lib/products";
import {
  currentPeriodWindow,
  type SubUser,
} from "@/lib/subscription";

// GET /api/dashboard/billing-stats?asUserId=<uuid>
//
// Renvoie tout ce dont le dashboard billing a besoin : état de l'abonnement,
// fenêtre de période courante, usage (minutes consommées vs incluses), volume
// d'appels par jour (entrants/sortants), répartition par issue, et l'historique
// de paiements (reçus). `asUserId` permet à un admin d'auditer un tenant.
//
// Aucune écriture. Toute l'agrégation est faite en SQL (timezone Asia/Jerusalem
// pour le group-by par jour, cohérent avec le reste de l'app).

const TZ = "Asia/Jerusalem";

export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ("forbidden" in r) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = r.userId;

  const [me] = await db
    .select({
      subscriptionStatus: users.subscriptionStatus,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionPeriod: users.subscriptionPeriod,
      trialEndsAt: users.trialEndsAt,
      paidUntil: users.paidUntil,
      autoRenew: users.autoRenew,
      cancelledAt: users.cancelledAt,
      scheduledPlan: users.scheduledPlan,
      scheduledPlanPeriod: users.scheduledPlanPeriod,
      scheduledPlanAt: users.scheduledPlanAt,
      cardLast4: users.cardLast4,
      cardBrand: users.cardBrand,
      locale: users.locale,
      products: users.products,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!me) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const planKey: PlanKey = isValidPlanKey(me.subscriptionPlan)
    ? me.subscriptionPlan
    : DEFAULT_PLAN_KEY;
  const plan = PLANS.find((p) => p.key === planKey) ?? PLANS[0];
  const currency = currencyForLocale(me.locale ?? "fr");
  // Existing accounts (users.products NULL or invalid) are grandfathered:
  // PLANS minutes and OVERAGE_RATE_ILS_PER_MIN, exactly as before, and the
  // catalogue is not even read. Only an account with a valid products record
  // reads the catalogue: minutes = base + add-ons in its currency, overage =
  // the base's ILS rate (the field is ILS).
  let minutesIncluded = plan.minutesIncluded;
  let overageRateIls = OVERAGE_RATE_ILS_PER_MIN;
  const ent = entitledProducts({
    subscriptionPlan: me.subscriptionPlan,
    subscriptionStatus: me.subscriptionStatus,
    products: me.products,
  });
  if (ent.source === "products" && ent.base) {
    const cat = await getProductCatalogue();
    minutesIncluded = [ent.base, ...ent.addons].reduce((sum, p) => sum + catalogueMinutes(cat, p, currency), 0);
    overageRateIls = catalogueOverage(cat, ent.base, "ILS");
  }

  const subUser: SubUser = {
    subscriptionStatus: me.subscriptionStatus,
    subscriptionPlan: planKey,
    subscriptionPeriod:
      me.subscriptionPeriod === "annual" || me.subscriptionPeriod === "monthly"
        ? me.subscriptionPeriod
        : null,
    trialEndsAt: me.trialEndsAt ?? null,
    paidUntil: me.paidUntil ?? null,
  };
  const window = currentPeriodWindow(subUser, now);

  // ─ Usage : minutes consommées sur la période (entrants + sortants) ─
  const [inboundAgg] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${calls.durationSeconds}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.userId, userId),
        gte(calls.createdAt, window.start),
        lte(calls.createdAt, window.end),
      ),
    );

  const [outboundAgg] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${campaignCalls.durationSeconds}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(
      and(
        eq(campaignCalls.userId, userId),
        gte(campaignCalls.createdAt, window.start),
        lte(campaignCalls.createdAt, window.end),
      ),
    );

  const minutesUsed = Math.round(
    ((inboundAgg?.seconds ?? 0) + (outboundAgg?.seconds ?? 0)) / 60,
  );

  // ─ Appels par jour (TZ Jerusalem) : entrants + sortants, fusionnés ─
  const inboundDaily = await db
    .select({
      date: sql<string>`to_char(${calls.createdAt} at time zone ${TZ}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.userId, userId),
        gte(calls.createdAt, window.start),
        lte(calls.createdAt, window.end),
      ),
    )
    .groupBy(sql`1`);

  const outboundDaily = await db
    .select({
      date: sql<string>`to_char(${campaignCalls.createdAt} at time zone ${TZ}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(
      and(
        eq(campaignCalls.userId, userId),
        gte(campaignCalls.createdAt, window.start),
        lte(campaignCalls.createdAt, window.end),
      ),
    )
    .groupBy(sql`1`);

  const byDate = new Map<string, { inbound: number; outbound: number }>();
  for (const r of inboundDaily) {
    const e = byDate.get(r.date) ?? { inbound: 0, outbound: 0 };
    e.inbound = r.count;
    byDate.set(r.date, e);
  }
  for (const r of outboundDaily) {
    const e = byDate.get(r.date) ?? { inbound: 0, outbound: 0 };
    e.outbound = r.count;
    byDate.set(r.date, e);
  }
  const callsPerDay = [...byDate.entries()]
    .map(([date, v]) => ({ date, inbound: v.inbound, outbound: v.outbound }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ─ Répartition par issue (campagnes sortantes) ─
  const outcomeRows = await db
    .select({
      outcome: campaignCalls.outcome,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(
      and(
        eq(campaignCalls.userId, userId),
        gte(campaignCalls.createdAt, window.start),
        lte(campaignCalls.createdAt, window.end),
      ),
    )
    .groupBy(campaignCalls.outcome);

  // ─ Historique de paiements (reçus) ─
  const payments = await db
    .select({
      id: paymentOrders.id,
      planKey: paymentOrders.planKey,
      period: paymentOrders.period,
      currency: paymentOrders.currency,
      amount: paymentOrders.expectedAmount,
      status: paymentOrders.status,
      kind: paymentOrders.kind,
      paidAt: paymentOrders.paidAt,
      createdAt: paymentOrders.createdAt,
    })
    .from(paymentOrders)
    .where(
      and(eq(paymentOrders.userId, userId), eq(paymentOrders.status, "paid")),
    )
    .orderBy(desc(paymentOrders.paidAt))
    .limit(50);

  return NextResponse.json({
    plan: planKey,
    status: me.subscriptionStatus,
    period: subUser.subscriptionPeriod,
    paidUntil: me.paidUntil?.toISOString() ?? null,
    trialEndsAt: me.trialEndsAt?.toISOString() ?? null,
    autoRenew: me.autoRenew,
    cancelledAt: me.cancelledAt?.toISOString() ?? null,
    scheduledPlan: isValidPlanKey(me.scheduledPlan) ? me.scheduledPlan : null,
    scheduledPlanPeriod: me.scheduledPlanPeriod ?? null,
    scheduledPlanAt: me.scheduledPlanAt?.toISOString() ?? null,
    card: me.cardLast4 ? { last4: me.cardLast4, brand: me.cardBrand } : null,
    currency,
    window: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      kind: window.kind,
    },
    usage: {
      minutesUsed,
      minutesIncluded,
      overageRateIls,
    },
    callsPerDay,
    outcomes: {
      inboundTotal: inboundAgg?.count ?? 0,
      outboundTotal: outboundAgg?.count ?? 0,
      campaign: outcomeRows.map((r) => ({ outcome: r.outcome, count: r.count })),
    },
    payments: payments.map((p) => ({
      id: p.id,
      planKey: p.planKey,
      period: p.period,
      currency: p.currency,
      amount: p.amount,
      status: p.status,
      kind: p.kind,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
