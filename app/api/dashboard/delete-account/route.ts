import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { signOut } from "@/auth";
import { requireSession } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
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
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody<{ confirmEmail?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const typed = (parsed.data.confirmEmail ?? "").trim().toLowerCase();

  const [me] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, guard.userId))
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
