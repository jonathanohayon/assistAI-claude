import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { createEmailVerification } from "@/lib/verify-code";

// POST /api/auth/resend-verification
// Body : { email }
//
// Génère un nouveau code (expire l'ancien), envoie email. Throttle 60s
// entre 2 resends via le cooldown intégré dans createEmailVerification.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Email requis" },
      { status: 400 },
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  // Réponse identique pour user inexistant vs throttle → évite l'enum
  // attack qui révélerait quels emails sont enregistrés.
  if (!user) {
    return NextResponse.json({ ok: true, dispatched: false });
  }
  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const verif = await createEmailVerification(user.id);
  if (!verif.ok) {
    if (verif.reason === "cooldown") {
      return NextResponse.json(
        {
          ok: false,
          reason: "cooldown",
          error: `Patientez ${verif.cooldownSeconds}s avant de redemander un code.`,
          cooldownSeconds: verif.cooldownSeconds,
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { ok: false, error: verif.reason ?? "Création de code échouée" },
      { status: 500 },
    );
  }

  const sent = await sendVerificationEmail(email, verif.code!, user.locale);
  const isDevFallback = sent.fallback === "console_log";
  await logEvent({
    source: "auth",
    event: sent.ok ? "verification_resent" : "verification_resend_failed",
    message: sent.ok
      ? isDevFallback
        ? `[DEV] Code renvoyé à ${email} : ${verif.code} (RESEND_API_KEY absent)`
        : `Code renvoyé à ${email}`
      : `Renvoi du code à ${email} échoué : ${sent.error}`,
    level: sent.ok ? (isDevFallback ? "warn" : "info") : "error",
    userId: user.id,
    metadata: {
      fallback: sent.fallback,
      error: sent.error,
      devCode: isDevFallback ? verif.code : undefined,
    },
  });

  return NextResponse.json({ ok: sent.ok, error: sent.error });
}
