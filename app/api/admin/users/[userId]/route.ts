import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { isValidPlanKey } from "@/lib/plans";
import { fullyDeleteUser } from "@/lib/release-user";

// Date très lointaine = "accès illimité" : le compte reste 'active' et n'est
// jamais expiré par le cron billing (qui ne flippe que les paidUntil < now).
const UNLIMITED_PAID_UNTIL = new Date("2099-12-31T00:00:00.000Z");

// PATCH /api/admin/users/[userId]
// Body { plan?, freeUnlimited?: boolean }
//   - plan : assigne un plan au tenant (whatsapp | global | premium).
//   - freeUnlimited true  : accès illimité GRATUIT (active, paidUntil=2099,
//       trial nettoyé, pas de renouvellement auto/facturation).
//   - freeUnlimited false : révoque → repasse 'expired' (paidUntil=now).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  const { userId } = await params;
  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target)
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });

  const parsed = await parseJsonBody<{
    plan?: string;
    freeUnlimited?: boolean;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const updates: Partial<typeof users.$inferInsert> = {};
  const changed: string[] = [];

  if (body.plan != null) {
    if (!isValidPlanKey(body.plan))
      return NextResponse.json({ error: "plan invalide" }, { status: 400 });
    updates.subscriptionPlan = body.plan;
    changed.push(`plan=${body.plan}`);
  }

  if (body.freeUnlimited === true) {
    updates.subscriptionStatus = "active";
    updates.paidUntil = UNLIMITED_PAID_UNTIL;
    updates.subscriptionPeriod = "annual";
    updates.autoRenew = false; // gratuit → aucune tentative de facturation
    updates.cancelledAt = null;
    updates.trialEndsAt = null;
    updates.trialWarningSentAt = null;
    updates.deletionLockedUntil = null;
    updates.scheduledPlan = null;
    updates.scheduledPlanAt = null;
    changed.push("free_unlimited=on");
  } else if (body.freeUnlimited === false) {
    updates.subscriptionStatus = "expired";
    updates.paidUntil = new Date();
    changed.push("free_unlimited=off");
  }

  if (changed.length === 0) {
    return NextResponse.json({ error: "rien à modifier" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning({
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
      paidUntil: users.paidUntil,
    });

  await logEvent({
    source: "web",
    event: "admin_subscription_set",
    message: `Admin ${me.email} → ${target.email} : ${changed.join(", ")}`,
    userId: me.id,
    metadata: { targetUserId: userId, changed },
  });

  return NextResponse.json({ ok: true, user: updated });
}

// DELETE /api/admin/users/[userId]
// Wipes the tenant entirely. Schema cascades: agent_configs, calls,
// phone_numbers all drop with the user row. The events table FK is
// set null (audit trail kept under "(deleted user)" in logs).
//
// Refuses to delete:
//   - the calling admin themselves (would lock them out)
//   - any user that doesn't exist
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  const { userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  if (userId === me.id) {
    return NextResponse.json(
      { error: "Tu ne peux pas te supprimer toi-même." },
      { status: 400 },
    );
  }

  // fullyDeleteUser libère les numéros Twilio AVANT de delete la row DB
  // (sinon la cascade phone_numbers efface les SID Twilio nécessaires).
  // Best-effort sur le release : on log les échecs mais on supprime quand
  // même côté DB pour pas laisser de tenant orphelin.
  const { release, email } = await fullyDeleteUser(userId);
  if (!email) {
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  }

  await logEvent({
    source: "web",
    event: "tenant_deleted",
    message: `Admin ${me.email} a supprimé le tenant ${email} · Twilio: ${release.releasedCount} libérés, ${release.failedCount} échecs`,
    userId: me.id,
    metadata: {
      deletedUserId: userId,
      deletedEmail: email,
      twilioReleased: release.releasedCount,
      twilioFailed: release.failedCount,
      twilioErrors: release.errors,
    },
  });

  return NextResponse.json({
    ok: true,
    deleted: { id: userId, email },
    twilio: release,
  });
}
