import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PLAN_KEY, isValidPlanKey, type PlanKey } from "@/lib/plans";
import { classifyChange, effectiveDowngradeDate } from "@/lib/subscription";

// POST /api/dashboard/subscription/schedule-change
//
// Programme un DOWNGRADE en fin de période payée (pas de remboursement HYP →
// le tenant garde son plan supérieur jusqu'à paidUntil, puis bascule). Les
// upgrades ne passent PAS ici : ils sont immédiats via paiement HYP.
//
// Body: { plan: PlanKey | null, period?: 'monthly'|'annual' }
//   - plan null → annule un downgrade programmé.
//   - plan == plan courant → annule (no-op).
//   - plan upgrade → 400 (doit passer par le paiement).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    plan?: string | null;
    period?: string;
  };

  const [me] = await db
    .select({
      subscriptionPlan: users.subscriptionPlan,
      subscriptionPeriod: users.subscriptionPeriod,
      paidUntil: users.paidUntil,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Annulation d'un downgrade programmé.
  if (body.plan == null) {
    await db
      .update(users)
      .set({ scheduledPlan: null, scheduledPlanPeriod: null, scheduledPlanAt: null })
      .where(eq(users.id, session.user.id));
    await logEvent({
      source: "auth",
      event: "subscription_schedule_cleared",
      message: "Changement de plan programmé annulé",
      userId: session.user.id,
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (!isValidPlanKey(body.plan)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }
  const nextPlan: PlanKey = body.plan;
  const currentPlan: PlanKey = isValidPlanKey(me.subscriptionPlan)
    ? me.subscriptionPlan
    : DEFAULT_PLAN_KEY;

  const change = classifyChange(currentPlan, nextPlan);
  if (change === "same") {
    // Rien à programmer — on nettoie un éventuel downgrade pending.
    await db
      .update(users)
      .set({ scheduledPlan: null, scheduledPlanPeriod: null, scheduledPlanAt: null })
      .where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (change === "upgrade") {
    return NextResponse.json(
      { error: "upgrade_requires_payment" },
      { status: 400 },
    );
  }

  const period =
    body.period === "annual" || body.period === "monthly"
      ? body.period
      : me.subscriptionPeriod === "annual"
        ? "annual"
        : "monthly";

  const effectiveAt = effectiveDowngradeDate(
    {
      subscriptionStatus: "active",
      subscriptionPlan: currentPlan,
      subscriptionPeriod:
        me.subscriptionPeriod === "annual" ? "annual" : "monthly",
      trialEndsAt: null,
      paidUntil: me.paidUntil ?? null,
    },
    new Date(),
  );

  await db
    .update(users)
    .set({
      scheduledPlan: nextPlan,
      scheduledPlanPeriod: period,
      scheduledPlanAt: effectiveAt,
    })
    .where(eq(users.id, session.user.id));

  await logEvent({
    source: "auth",
    event: "subscription_downgrade_scheduled",
    message: `Downgrade ${currentPlan} → ${nextPlan} programmé pour le ${effectiveAt.toISOString()}`,
    userId: session.user.id,
    metadata: { from: currentPlan, to: nextPlan, period, effectiveAt: effectiveAt.toISOString() },
  });

  return NextResponse.json({
    ok: true,
    scheduledPlan: nextPlan,
    effectiveAt: effectiveAt.toISOString(),
  });
}
