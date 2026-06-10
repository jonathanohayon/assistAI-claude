import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
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
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody<{ password?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const password = String(parsed.data.password ?? "");
  if (password.length < 8) {
    return NextResponse.json({ error: "too_short" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, guard.userId));

  await logEvent({
    source: "auth",
    event: "password_set",
    message: "Mot de passe défini/mis à jour depuis les réglages",
    userId: guard.userId,
  });

  return NextResponse.json({ ok: true });
}
