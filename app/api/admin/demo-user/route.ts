import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { getDemoUserId, setDemoUserId } from "@/lib/settings";

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

// GET → { demoUserId } courant.
export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ demoUserId: await getDemoUserId() });
}

// POST { userId: string | null } — déclare (ou retire) le compte démo de la
// page d'accueil. userId null/"" → retire la démo (retour à l'agent anonyme).
export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string | null };
  const userId = (body.userId ?? "").trim();

  if (userId) {
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target)
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  await setDemoUserId(userId || null);
  await logEvent({
    source: "web",
    event: "admin_demo_user_set",
    message: userId
      ? `Compte démo home défini : ${userId}`
      : "Compte démo home retiré",
    userId: me.id,
    metadata: { demoUserId: userId || null },
  });

  return NextResponse.json({ ok: true, demoUserId: userId || null });
}
