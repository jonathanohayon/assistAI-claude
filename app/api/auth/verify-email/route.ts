import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { verifyEmailCode } from "@/lib/verify-code";

// POST /api/auth/verify-email
// Body : { email, code }
//
// Vérifie le code à 4 chiffres pour le user identifié par email. Si OK,
// marque users.email_verified = true. La page client appelle ensuite
// signIn() côté browser (next-auth/react) pour créer la session.
//
// On NE fait PAS le signIn ici parce que les server actions NextAuth ont
// besoin du contexte form-action ; un endpoint REST classique est plus
// simple à brancher au form /verify-email.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();

  if (!email || !code) {
    return NextResponse.json(
      { ok: false, error: "Email et code requis" },
      { status: 400 },
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Aucun compte avec cet email." },
      { status: 404 },
    );
  }
  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const result = await verifyEmailCode(user.id, code);
  if (!result.ok) {
    const messages: Record<string, string> = {
      no_code: "Aucun code actif. Cliquez sur « Renvoyer » pour en recevoir un.",
      expired: "Code expiré. Cliquez sur « Renvoyer » pour en recevoir un nouveau.",
      max_attempts:
        "Trop d'essais. Cliquez sur « Renvoyer » pour recevoir un nouveau code.",
      wrong_code:
        result.attemptsLeft != null
          ? `Code incorrect. ${result.attemptsLeft} tentative${result.attemptsLeft > 1 ? "s" : ""} restante${result.attemptsLeft > 1 ? "s" : ""}.`
          : "Code incorrect.",
    };
    await logEvent({
      source: "auth",
      event: "verify_failed",
      message: `Vérif code échouée pour ${email} : ${result.reason}`,
      level: "warn",
      userId: user.id,
      metadata: { reason: result.reason, attemptsLeft: result.attemptsLeft },
    });
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        error: messages[result.reason] ?? "Code invalide",
        attemptsLeft: result.attemptsLeft,
      },
      { status: 400 },
    );
  }

  await logEvent({
    source: "auth",
    event: "verify_success",
    message: `Email vérifié : ${email}`,
    userId: user.id,
  });
  return NextResponse.json({ ok: true });
}
