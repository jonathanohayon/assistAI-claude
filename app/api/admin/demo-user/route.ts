import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { getDemoUserId, setDemoUserId } from "@/lib/settings";

// GET → { demoUserId } courant.
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ demoUserId: await getDemoUserId() });
}

// POST { userId: string | null } — déclare (ou retire) le compte démo de la
// page d'accueil. userId null/"" → retire la démo (retour à l'agent anonyme).
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  // body optionnel : userId null/"" (ou body vide) = retirer la démo.
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
