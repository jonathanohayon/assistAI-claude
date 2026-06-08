import { and, eq, isNotNull, lt, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { isValidPlanKey } from "@/lib/plans";

// Cron billing : gère le cycle de vie des abonnements payants (hors trial,
// qui reste dans /api/cron/trial-cleanup). Deux phases idempotentes par tick :
//
//   1) Downgrades programmés : pour chaque user dont scheduled_plan_at ≤ now,
//      applique le plan programmé (en fin de période payée) et nettoie les
//      champs scheduled_*. Pas de remboursement — l'user a gardé son plan
//      supérieur jusqu'à paidUntil.
//   2) Expiration : pour chaque user 'active' dont paidUntil < now et qui ne
//      peut PAS être renouvelé automatiquement (auto_renew=false, ou pas de
//      token, ou tokenisation désactivée), passe le compte en 'expired'.
//
//   (Le renouvellement auto par token HYP est Phase D — branché ici derrière
//    HYP_TOKENS_ENABLED quand le contrat token sera vérifié sur le masof.)
//
// Auth : INTERNAL_SECRET via header x-internal-secret. Fréquence : ~horaire.

export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let downgraded = 0;
  let expired = 0;

  // ─── Phase 1 : appliquer les downgrades programmés ──────────────────────
  const toDowngrade = await db
    .select({
      id: users.id,
      email: users.email,
      subscriptionPlan: users.subscriptionPlan,
      scheduledPlan: users.scheduledPlan,
      scheduledPlanPeriod: users.scheduledPlanPeriod,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.scheduledPlan),
        isNotNull(users.scheduledPlanAt),
        lte(users.scheduledPlanAt, now),
      ),
    );

  for (const u of toDowngrade) {
    if (!isValidPlanKey(u.scheduledPlan)) {
      // Plan programmé invalide → on nettoie sans rien appliquer.
      await db
        .update(users)
        .set({ scheduledPlan: null, scheduledPlanPeriod: null, scheduledPlanAt: null })
        .where(eq(users.id, u.id));
      continue;
    }
    const period =
      u.scheduledPlanPeriod === "annual" ? "annual" : "monthly";
    await db
      .update(users)
      .set({
        subscriptionPlan: u.scheduledPlan,
        subscriptionPeriod: period,
        scheduledPlan: null,
        scheduledPlanPeriod: null,
        scheduledPlanAt: null,
      })
      .where(eq(users.id, u.id));
    downgraded++;
    await logEvent({
      source: "auth",
      event: "subscription_downgrade_applied",
      message: `Downgrade appliqué : ${u.subscriptionPlan} → ${u.scheduledPlan}`,
      userId: u.id,
      metadata: { from: u.subscriptionPlan, to: u.scheduledPlan, period },
    });
  }

  // ─── Phase 2 : expirer les abonnements non renouvelables ────────────────
  // Phase D ajoutera ici la branche "auto-renew via token" AVANT l'expiration.
  const toExpire = await db
    .select({ id: users.id, email: users.email, paidUntil: users.paidUntil })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "active"),
        isNotNull(users.paidUntil),
        lt(users.paidUntil, now),
      ),
    );

  for (const u of toExpire) {
    await db
      .update(users)
      .set({ subscriptionStatus: "expired" })
      .where(eq(users.id, u.id));
    expired++;
    await logEvent({
      source: "auth",
      event: "subscription_expired",
      message: `Abonnement expiré (paidUntil ${u.paidUntil?.toISOString() ?? "?"})`,
      userId: u.id,
      metadata: { paidUntil: u.paidUntil?.toISOString() ?? null },
    });
  }

  return NextResponse.json({
    ok: true,
    downgraded,
    expired,
    tookMs: Date.now() - now.getTime(),
  });
}
