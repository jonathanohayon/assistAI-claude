import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { fullyDeleteUser } from "@/lib/release-user";

// POST /api/dashboard/delete-account
// Body : { confirmEmail: string }
//
// Self-service deletion : le user supprime son propre compte. On exige
// qu'il retape son email pour confirmer (anti fat-finger sur action
// destructive). Libère ses numéros Twilio puis cascade DB. signOut.
//
// Sécurité :
//   - Session auth obligatoire
//   - confirmEmail doit matcher l'email session (sinon refus)
//   - Admin ne peut pas se self-delete via ce endpoint (would lock out
//     l'instance — passer par l'autre admin si plusieurs)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    confirmEmail?: string;
  };
  const typed = (body.confirmEmail ?? "").trim().toLowerCase();

  const [me] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  if (me.role === "admin") {
    return NextResponse.json(
      {
        error:
          "Les comptes admin ne peuvent pas s'auto-supprimer. Demande à un autre admin de te supprimer via le panneau /admin.",
      },
      { status: 403 },
    );
  }

  if (typed !== me.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: "L'email saisi ne correspond pas. Annulé.",
      },
      { status: 400 },
    );
  }

  const { release } = await fullyDeleteUser(me.id);
  await logEvent({
    source: "auth",
    event: "self_account_deleted",
    message: `Self-suppression compte ${me.email} · Twilio: ${release.releasedCount} libérés, ${release.failedCount} échecs`,
    metadata: {
      email: me.email,
      twilioReleased: release.releasedCount,
      twilioFailed: release.failedCount,
      twilioErrors: release.errors,
    },
  });

  // Force-clear la session (le user n'existe plus en DB de toute façon).
  await signOut({ redirect: false });
  return NextResponse.json({ ok: true, twilio: release });
}
