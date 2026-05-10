import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

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

  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  }

  await db.delete(users).where(eq(users.id, userId));

  await logEvent({
    source: "web",
    event: "tenant_deleted",
    message: `Admin ${me.email} a supprimé le tenant ${target.email}`,
    userId: me.id,
    metadata: { deletedUserId: userId, deletedEmail: target.email },
  });

  return NextResponse.json({ ok: true, deleted: target });
}
