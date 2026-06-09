import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/dashboard/set-password  body { password }
// Permet à un utilisateur connecté — notamment inscrit via Google, donc sans
// mot de passe utilisable — de définir/mettre à jour son mot de passe afin de
// pouvoir se connecter ensuite en email + mot de passe.
//
// Sécurité : la session prouve l'identité. Pas de "current password" exigé,
// car un compte OAuth n'en a pas (un détournement de session = déjà un accès
// complet, donc aucun risque nouveau).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? "");
  if (password.length < 8) {
    return NextResponse.json({ error: "too_short" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, session.user.id));

  await logEvent({
    source: "auth",
    event: "password_set",
    message: "Mot de passe défini/mis à jour depuis les réglages",
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
