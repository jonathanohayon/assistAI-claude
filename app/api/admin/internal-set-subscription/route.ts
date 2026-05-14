import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Internal-only setter pour piloter l'état d'abonnement d'un user sans
// passer par Stripe / dashboard billing. Gated INTERNAL_SECRET. Utilisé
// pour les comptes ops (admin, comptes test, premiers clients qui paient
// hors Stripe) qu'on veut sortir du gate trial.
//
// Body :
//   { email?, userId?, status?, plan?, clearTrialDates? }
// - status : 'trialing' | 'active' | 'expired' | 'cancelled'
// - plan : 'whatsapp' | 'global' | 'premium' (legacy 'essential' accepté)
// - clearTrialDates : true → met trial_ends_at + trial_warning_sent_at à
//   NULL (utile quand on passe trial → active : on veut plus que le cron
//   trial-cleanup les supprime).
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    userId?: string;
    status?: string;
    plan?: string;
    clearTrialDates?: boolean;
  };

  let userId = body.userId;
  if (!userId && body.email) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!u) {
      return NextResponse.json({ error: "email introuvable" }, { status: 404 });
    }
    userId = u.id;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "userId ou email requis" },
      { status: 400 },
    );
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (body.status != null) {
    const allowed = ["trialing", "active", "expired", "cancelled"];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: `status invalide (${allowed.join("|")})` },
        { status: 400 },
      );
    }
    updates.subscriptionStatus = body.status;
  }
  if (body.plan != null) {
    updates.subscriptionPlan = body.plan;
  }
  if (body.clearTrialDates === true) {
    updates.trialEndsAt = null;
    updates.trialWarningSentAt = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Aucun champ à mettre à jour" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionPlan: users.subscriptionPlan,
      trialEndsAt: users.trialEndsAt,
      trialWarningSentAt: users.trialWarningSentAt,
    });

  return NextResponse.json({ ok: true, user: updated });
}
