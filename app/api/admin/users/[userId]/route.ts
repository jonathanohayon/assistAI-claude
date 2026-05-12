import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { fullyDeleteUser } from "@/lib/release-user";

const requireAdmin = async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return me?.role === "admin" ? me : null;
};

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
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
