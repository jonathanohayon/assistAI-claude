import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/dashboard/subscription/resume
//
// Réactive le renouvellement auto d'un abonnement annulé, tant que la période
// payée n'est pas expirée (paidUntil > now). Au-delà, le tenant doit repayer
// (le compte est 'expired'), donc on refuse.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [me] = await db
    .select({ paidUntil: users.paidUntil })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  if (!me.paidUntil || me.paidUntil.getTime() <= now.getTime()) {
    return NextResponse.json(
      { error: "expired", message: "Période expirée — un nouveau paiement est requis." },
      { status: 409 },
    );
  }

  await db
    .update(users)
    .set({ autoRenew: true, cancelledAt: null })
    .where(eq(users.id, session.user.id));

  await logEvent({
    source: "auth",
    event: "subscription_resumed",
    message: "Renouvellement auto réactivé",
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
