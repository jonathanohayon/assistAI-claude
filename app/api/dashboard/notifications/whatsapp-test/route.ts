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

  // Si on a un template OWNER approuvé en env, on l'utilise pour
  // bypass la fenêtre 24h Meta. Sinon, freeform : marche uniquement si
  // le destinataire a déjà parlé au numéro Twilio dans les 24h dernières
  // (ou a join le sandbox via "join <code>" pour le numéro sandbox).
  const ownerTemplateSid =
    process.env.WHATSAPP_OWNER_TEMPLATE_SID ??
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_FR ??
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_HE ??
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_EN;

  const result = await sendWhatsApp({
    to: cleaned,
    body: message,
    ...(ownerTemplateSid ? { templateSid: ownerTemplateSid } : {}),
    ownerTemplateFallback: true,
  });

  if (!result.ok) {
    const fromSandbox = (process.env.TWILIO_WHATSAPP_FROM ?? "").includes(
      "+14155238886",
    );
    return NextResponse.json(
      {
        error: result.error ?? "Échec d'envoi WhatsApp",
        hint: fromSandbox
          ? `Tu utilises le sandbox Twilio (+14155238886). Pour recevoir un message, envoie d'abord "join <ton-code>" depuis ${cleaned} vers +14155238886 (le code est dans Twilio Console → Messaging → Try It Out → WhatsApp Sandbox).`
          : ownerTemplateSid
            ? `Template SID ${ownerTemplateSid} a échoué. Vérifie son statut Meta (peut-être pending/rejected) via la Twilio Content API.`
            : "Aucun WHATSAPP_OWNER_TEMPLATE_SID en env → freeform tenté. Pour bypass la fenêtre 24h Meta, ajoute le SID d'un template owner approved (HE/EN sont approved actuellement, FR encore pending au 2026-05-14).",
        provider: process.env.WHATSAPP_PROVIDER ?? "meta",
        usedTemplate: Boolean(ownerTemplateSid),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    sid: result.sid,
    usedTemplate: Boolean(ownerTemplateSid),
  });
}
