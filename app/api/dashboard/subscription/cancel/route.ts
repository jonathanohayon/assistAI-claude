import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/dashboard/subscription/cancel
//
// Annulation d'abonnement : on ne rembourse pas (HYP n'expose pas de refund
// API) et on ne coupe pas l'accès immédiatement. On stoppe le renouvellement
// auto et on marque la date d'annulation — l'accès reste jusqu'à paidUntil,
// après quoi le cron billing repassera le compte en 'expired'. Modèle pro
// standard "cancel at period end".
export async function POST() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const [me] = await db
    .select({
      subscriptionStatus: users.subscriptionStatus,
      paidUntil: users.paidUntil,
    })
    .from(users)
    .where(eq(users.id, guard.userId))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(users)
    .set({ autoRenew: false, cancelledAt: new Date() })
    .where(eq(users.id, guard.userId));

  await logEvent({
    source: "auth",
    event: "subscription_cancelled",
    message: `Abonnement annulé (accès jusqu'au ${me.paidUntil?.toISOString() ?? "?"})`,
    userId: guard.userId,
    metadata: { paidUntil: me.paidUntil?.toISOString() ?? null },
  });

  return NextResponse.json({
    ok: true,
    accessUntil: me.paidUntil?.toISOString() ?? null,
  });
}
