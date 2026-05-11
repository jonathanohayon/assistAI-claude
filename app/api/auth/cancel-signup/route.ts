import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/auth/cancel-signup
// Pour le flow signup → verify-email : laisse au user un escape hatch
// "recommencer à zéro". Supprime DÉFINITIVEMENT son compte SI et seulement
// si son email n'a pas encore été vérifié (= en plein signup, pas encore
// onboard). Cascade DB nettoie agent_configs / phone_numbers / verifications.
//
// Sécurité :
//   - Session auth requise (sinon impossible de connaître quel user delete)
//   - Refus si emailVerified=true (un user pleinement actif ne peut PAS
//     se nuke via ce endpoint — il faut passer par admin DELETE)
//   - signOut systématique après le delete (sinon session zombie)
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [me] = await db
    .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) {
    // User déjà supprimé ailleurs — signOut quand même pour clear cookie.
    await signOut({ redirect: false });
    return NextResponse.json({ ok: true, alreadyGone: true });
  }
  if (me.emailVerified) {
    return NextResponse.json(
      {
        error:
          "Compte déjà vérifié. Pour supprimer, passe par les paramètres du dashboard.",
      },
      { status: 403 },
    );
  }

  // Delete cascade : agent_configs / phone_numbers / email_verifications /
  // calls / events.userId set null (audit trail kept).
  await db.delete(users).where(and(eq(users.id, me.id), eq(users.emailVerified, false)));
  await logEvent({
    source: "auth",
    event: "signup_cancelled",
    message: `Signup annulé par ${me.email} avant vérification — compte supprimé`,
    metadata: { email: me.email },
  });

  // Force-clear la session.
  await signOut({ redirect: false });
  return NextResponse.json({ ok: true });
}
