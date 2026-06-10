import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { sendNotificationTestEmail } from "@/lib/email";

// Envoie un email de test branded Tamara au destinataire passé en body.
// Auth requis. Locale détectée depuis Accept-Language ou query param
// `?locale=fr|he|en` ; sinon FR par défaut.
//
// Réponses :
//   200 OK    -> { ok: true, id }
//   400       -> body invalide (email absent / pas de @)
//   401       -> pas auth
//   500       -> erreur Resend
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody<{ to?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const to = (parsed.data.to ?? "").trim();
  if (!to) {
    return NextResponse.json(
      { error: "Adresse email manquante" },
      { status: 400 },
    );
  }
  // Sanity check basique — Resend valide plus strictement de toute façon.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json(
      { error: "Format email invalide" },
      { status: 400 },
    );
  }

  const localeParam = req.nextUrl.searchParams.get("locale");
  const acceptLang = req.headers.get("accept-language") ?? "";
  const locale =
    localeParam ?? acceptLang.split(",")[0]?.split("-")[0] ?? "fr";

  const result = await sendNotificationTestEmail(to, {
    recipientName: session.user.name ?? session.user.email?.split("@")[0],
    locale,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error ?? "Échec d'envoi email",
        hint: process.env.RESEND_API_KEY
          ? "Vérifie l'adresse + que ton domaine EMAIL_FROM est validé dans Resend (sinon Resend bloque l'envoi)."
          : "RESEND_API_KEY non configuré en env. L'email a été loggé en console en mode dev/fallback.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    fallback: result.fallback,
  });
}
