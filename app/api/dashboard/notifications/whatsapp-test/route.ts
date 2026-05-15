import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { sendWhatsApp } from "@/lib/whatsapp";

// Envoie un message WhatsApp de test au numéro fourni (typiquement le
// `ownerWhatsapp` que le user vient de saisir dans /dashboard config).
// Auth requis car ça consomme Twilio/Meta quota.
//
// Le body est freeform court : marche dans la fenêtre 24h, sinon
// `ownerTemplateFallback: true` bascule sur le template Meta approved.
//
// Réponse :
//   200 OK     -> { ok: true, sid }
//   400        -> body invalide (numéro absent / pas E.164)
//   401        -> pas auth
//   500        -> erreur Twilio/Meta (passe l'error dans le body)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    to?: string;
  };
  const raw = (body.to ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { error: "Numéro destinataire manquant" },
      { status: 400 },
    );
  }
  // Light E.164 sanity check — sendWhatsApp normalize ensuite.
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (!/^\+?\d{6,15}$/.test(cleaned)) {
    return NextResponse.json(
      { error: "Format E.164 attendu (ex: +972585001007)" },
      { status: 400 },
    );
  }

  const greet =
    session.user.name ?? session.user.email?.split("@")[0] ?? "Owner";
  const message = `🔔 *Tamara — Test notification*\n\nBonjour ${greet}, ceci est un test depuis ton dashboard.\nSi tu lis ce message, les notifications WhatsApp sont opérationnelles ✓`;

  const result = await sendWhatsApp({
    to: cleaned,
    body: message,
    // Si l'owner n'a jamais écrit au numéro Twilio dans les 24h, freeform
    // est bloqué par Meta. Le fallback bascule alors sur le template owner
    // approved (cf. memory whatsapp_templates_state).
    ownerTemplateFallback: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error ?? "Échec d'envoi WhatsApp",
        hint:
          "Si tu ne reçois rien : (a) vérifie que le numéro est bien le tien en E.164, (b) ouvre une 1ʳᵉ fois la conversation en envoyant 'bonjour' au numéro Twilio Tamara depuis ton tel pour ouvrir la fenêtre 24h, (c) sinon le template owner FR est probablement encore pending côté Meta — bascule sur HE/EN en attendant.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, sid: result.sid });
}
