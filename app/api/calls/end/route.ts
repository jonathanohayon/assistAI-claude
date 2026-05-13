import { and, eq, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls, events } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { DEFAULT_PLAN_KEY, isValidPlanKey, type PlanKey } from "@/lib/plans";
import { getSummaryPromptByPlan } from "@/lib/settings";
import {
  ensureSheet,
  forceTextPhone,
  prependRow,
} from "@/lib/sheets-helpers";
import { summarizeCall } from "@/lib/summarize";
import { resolveTenant } from "@/lib/tenant";
import { checkTwilioMessageStatus, sendWhatsApp } from "@/lib/whatsapp";

const APPELS_SHEET_TITLE = "Appels";
const APPELS_HEADERS = [
  "Date",
  "Heure",
  "Caller",
  "Numéro",
  "Durée",
  "Type",
  "Résumé",
];

interface EndBody {
  fromNumber?: string;
  toNumber?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Durée de l'appel en secondes (best-effort, peut être undefined). */
  durationSeconds?: number;
}

/**
 * Vérifie le delivery status Twilio d'un message 8s après l'envoi. Si Twilio
 * a bloqué silencieusement (status undelivered/failed, common reasons :
 * 63016 hors window 24h, 63007 sandbox sans opt-in, etc.), log un event
 * d'erreur queryable dans /dashboard/logs filtre WhatsApp. Async & best-
 * effort, ne bloque pas la response du endpoint.
 */
async function verifyDelivery(
  sid: string,
  recipient: "owner" | "client",
  to: string,
  userId: string,
  callId: string,
): Promise<void> {
  await new Promise((r) => setTimeout(r, 8000));
  const status = await checkTwilioMessageStatus(sid);
  if (!status) return;
  const ok = ["queued", "sent", "delivered", "read", "accepted"].includes(
    status.status,
  );
  if (!ok) {
    await logEvent({
      source: "whatsapp",
      event: `whatsapp_undelivered_${recipient}`,
      message: `WhatsApp ${recipient} non livré à ${to} (status=${status.status}${
        status.errorCode ? ` code=${status.errorCode}` : ""
      })${status.errorMessage ? ` : ${status.errorMessage.slice(0, 150)}` : ""}`,
      level: "error",
      userId,
      metadata: { callId, sid, to, ...status },
    });
  }
}

/**
 * Heuristique pour déduire le TYPE d'appel à partir du résumé / transcript :
 * RDV, Annulation, Modification, Message, ou Info. Affichage Sheets only.
 */
const inferCallType = (summary: string, transcript: string[]): string => {
  const all = (summary + " " + transcript.join(" ")).toLowerCase();
  if (/annul|cancel/.test(all)) return "Annulation";
  if (/déplac|report|reschedule|chang.*heure|chang.*date/.test(all))
    return "Modification";
  if (/take_message|laisse.*message|transmettre|rappelle/.test(all))
    return "Message";
  if (/réserv|book_appointment|rendez-vous|RDV/i.test(all)) return "RDV";
  return "Info";
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    await logEvent({
      source: "web",
      event: "calls_end_forbidden",
      message: "Tentative d'accès non autorisée à /api/calls/end",
      level: "warn",
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as EndBody;
  const fromNumber = (body.fromNumber ?? "").trim();
  const toNumber = (body.toNumber ?? "").trim();
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];

  const tenant = await resolveTenant(toNumber || null);
  if (!tenant) {
    await logEvent({
      source: "tenant",
      event: "tenant_not_found",
      message: `Aucun tenant pour le numéro ${toNumber}`,
      level: "error",
      metadata: { toNumber },
    });
    return NextResponse.json({ error: "no tenant" }, { status: 500 });
  }
  const { user, config: cfg } = tenant;

  const [callRow] = await db
    .insert(calls)
    .values({ userId: user.id, fromNumber, transcript, summary: "" })
    .returning();

  await logEvent({
    source: "agent",
    event: "call_received",
    message: `Appel reçu de ${fromNumber || "?"} pour ${user.email}`,
    userId: user.id,
    metadata: {
      callId: callRow.id,
      fromNumber,
      toNumber,
      transcriptEntries: transcript.length,
    },
  });

  if (transcript.length === 0) {
    await logEvent({
      source: "agent",
      event: "call_skipped_empty",
      message: "Transcript vide — aucun récap envoyé",
      level: "warn",
      userId: user.id,
      metadata: { callId: callRow.id },
    });
    return NextResponse.json({
      ok: true,
      callId: callRow.id,
      skipped: "empty transcript",
    });
  }

  let summary;
  try {
    // Optional per-plan custom system prompt from /admin. Fallback sur le
    // DEFAULT_SUMMARY_PROMPT hardcodé si l'admin n'a rien défini pour ce plan.
    const summaryByPlan = await getSummaryPromptByPlan();
    const planKey: PlanKey = isValidPlanKey(user.subscriptionPlan)
      ? user.subscriptionPlan
      : DEFAULT_PLAN_KEY;
    const customPrompt = summaryByPlan[planKey] || null;
    // Génère le summary dans la langue principale du tenant
    // (cfg.primaryLanguage) pour que for_client / for_owner soient en
    // FR/HE/EN selon le choix du tenant. Fallback fr si non set.
    const targetLang = cfg.primaryLanguage ?? "fr";
    summary = await summarizeCall(transcript, customPrompt, targetLang);
    await logEvent({
      source: "summary",
      event: "summary_generated",
      message: `Résumé généré (${summary.raw.length} chars)`,
      userId: user.id,
      metadata: { callId: callRow.id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "summary failed";
    await db
      .update(calls)
      .set({ whatsappError: `summary: ${msg}` })
      .where(eq(calls.id, callRow.id));
    await logEvent({
      source: "summary",
      event: "summary_failed",
      message: `Résumé échoué : ${msg.slice(0, 200)}`,
      level: "error",
      userId: user.id,
      metadata: { callId: callRow.id, error: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  await db
    .update(calls)
    .set({ summary: summary.raw })
    .where(eq(calls.id, callRow.id));

  let clientSid: string | null = null;
  let ownerSid: string | null = null;
  let waError: string | null = null;

  // Matrice features (admin/Réglages partagés) → décide si on envoie le
  // recap client (whatsapp_confirm) et/ou le recap owner (whatsapp_recap).
  // Read une fois par appel : c'est négligeable vs. le coût de l'appel.
  const planMatrix = await getPlanFeatureMatrix();
  const tenantFeatures = featuresForPlan(planMatrix, user.subscriptionPlan);

  if (fromNumber && tenantFeatures.whatsapp_confirm !== false) {
    // Client-facing recap: use Twilio Content Template if configured, so
    // the message ships même si la cliente n'a jamais WhatsAppé first.
    // Free-form falls back to the 24h-window rule.
    //
    // Per-language template routing : si WHATSAPP_CLIENT_TEMPLATE_SID_HE
    // (ou _EN, _FR) est défini sur Railway, on l'utilise pour les tenants
    // dont primaryLanguage matche. Sinon fallback sur le SID legacy
    // (WHATSAPP_CLIENT_TEMPLATE_SID = FR par défaut historique). Les
    // templates Meta-approved ne permettent pas de wrapper dynamique —
    // créer un template par langue dans Twilio est le seul moyen d'avoir
    // un "Bonjour..." en FR vs "שלום..." en HE.
    const tenantLang = (cfg.primaryLanguage ?? "fr").toUpperCase();
    const langKey = `WHATSAPP_CLIENT_TEMPLATE_SID_${tenantLang}`;
    const clientTemplate =
      process.env[langKey] || process.env.WHATSAPP_CLIENT_TEMPLATE_SID;
    const r = await sendWhatsApp({
      to: fromNumber,
      body: summary.forClient,
      templateSid: clientTemplate || undefined,
      templateVariables: clientTemplate
        ? { "1": summary.forClient.slice(0, 1000) }
        : undefined,
    });
    if (r.ok && r.sid) {
      clientSid = r.sid;
      await logEvent({
        source: "whatsapp",
        event: "whatsapp_sent_client",
        message: `WhatsApp envoyé à la cliente ${fromNumber}`,
        userId: user.id,
        metadata: { callId: callRow.id, sid: r.sid, to: fromNumber },
      });
      void verifyDelivery(r.sid, "client", fromNumber, user.id, callRow.id);
    } else {
      waError = `client: ${r.error}`;
      await logEvent({
        source: "whatsapp",
        event: "whatsapp_failed_client",
        message: `WhatsApp client échoué : ${r.error?.slice(0, 200)}`,
        level: "error",
        userId: user.id,
        metadata: { callId: callRow.id, to: fromNumber, error: r.error },
      });
    }
  }

  // Si l'agent a déjà notifié le proprio via take_message tool PENDANT
  // l'appel, le recap post-appel serait redondant (les 2 messages
  // contiennent essentiellement le même contenu). On query les events
  // récents pour ce user — si un whatsapp:notify_sent existe dans les
  // 5 dernières minutes, on skip le owner recap. Le client recap reste
  // (= confirmation envoyée à l'appelant·e, indépendante du take_message).
  const recentTakeMessageCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const recentNotifies = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, user.id),
        eq(events.source, "whatsapp"),
        eq(events.event, "notify_sent"),
        gt(events.createdAt, recentTakeMessageCutoff),
      ),
    )
    .limit(1);
  const takeMessageUsed = recentNotifies.length > 0;

  if (
    cfg.ownerWhatsapp &&
    tenantFeatures.whatsapp_recap !== false &&
    takeMessageUsed
  ) {
    // Trace explicite pour qu'on sache pourquoi le proprio n'a pas reçu
    // de recap post-appel — sinon ça ressemble à un bug silencieux.
    await logEvent({
      source: "whatsapp",
      event: "whatsapp_skipped_owner_dedup",
      message: `Recap proprio sauté : take_message déjà envoyé pendant l'appel à ${cfg.ownerWhatsapp}`,
      userId: user.id,
      metadata: { callId: callRow.id, to: cfg.ownerWhatsapp },
    });
  }

  if (
    cfg.ownerWhatsapp &&
    tenantFeatures.whatsapp_recap !== false &&
    !takeMessageUsed
  ) {
    const ownerBody = `📞 Nouvel appel reçu\n\n${summary.forOwner}\n\n— ${fromNumber || "numéro inconnu"}`;
    // Si WHATSAPP_OWNER_TEMPLATE_SID set → on passe par le template Twilio
    // (bypass la fenêtre 24h, livraison garantie hors WhatsApp interaction
    // récente). Sinon free-form (qui silently undelivered si hors window).
    // Routing per-langue identique au client : prefer _HE/_EN/_FR sur le
    // legacy SID. Le proprio reçoit donc le wrapper dans sa langue active.
    const ownerLangKey = `WHATSAPP_OWNER_TEMPLATE_SID_${(cfg.primaryLanguage ?? "fr").toUpperCase()}`;
    const ownerTemplate =
      process.env[ownerLangKey] || process.env.WHATSAPP_OWNER_TEMPLATE_SID;
    const r = await sendWhatsApp({
      to: cfg.ownerWhatsapp,
      body: ownerBody,
      templateSid: ownerTemplate || undefined,
      templateVariables: ownerTemplate
        ? { "1": ownerBody.slice(0, 1000) }
        : undefined,
      ownerTemplateFallback: true, // Meta provider only
    });
    if (r.ok && r.sid) {
      ownerSid = r.sid;
      await logEvent({
        source: "whatsapp",
        event: "whatsapp_sent_owner",
        message: `WhatsApp envoyé au proprio ${cfg.ownerWhatsapp}`,
        userId: user.id,
        metadata: { callId: callRow.id, sid: r.sid, to: cfg.ownerWhatsapp },
      });
      // Status check delayed : Twilio peut accepter (201 OK) puis bloquer
      // la livraison silencieusement (status undelivered, error 63016 = hors
      // window 24h). Async, ne bloque pas la response du endpoint.
      void verifyDelivery(r.sid, "owner", cfg.ownerWhatsapp, user.id, callRow.id);
    } else {
      waError = (waError ? waError + " | " : "") + `owner: ${r.error}`;
      await logEvent({
        source: "whatsapp",
        event: "whatsapp_failed_owner",
        message: `WhatsApp owner échoué : ${r.error?.slice(0, 200)}`,
        level: "error",
        userId: user.id,
        metadata: { callId: callRow.id, to: cfg.ownerWhatsapp, error: r.error },
      });
    }
  }

  await db
    .update(calls)
    .set({
      whatsappClientSid: clientSid,
      whatsappOwnerSid: ownerSid,
      whatsappError: waError,
    })
    .where(eq(calls.id, callRow.id));

  // Push au TOP de la sheet "Appels" (le plus récent en haut). Best-effort :
  // on log l'erreur mais on ne fait pas planter le endpoint si Sheets fail.
  // Le récap WhatsApp est plus critique que le log Sheets.
  try {
    const google = await getTenantGoogleClients(user.id);
    if (google?.sheetId) {
      const now = new Date();
      const date = now.toLocaleDateString("fr-FR", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const heure = now.toLocaleTimeString("fr-FR", {
        timeZone: "Asia/Jerusalem",
        hour: "2-digit",
        minute: "2-digit",
      });
      const dur = body.durationSeconds;
      const durFormatted =
        typeof dur === "number" && dur > 0
          ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`
          : "";
      const callType = inferCallType(
        summary.raw,
        transcript.map((t) => t.text),
      );
      // Format local du numéro pour lisibilité (cohérent avec ce que dit
      // l'agent au téléphone). +972 → 0XXX.
      const localFromNumber = fromNumber.startsWith("+972")
        ? "0" + fromNumber.slice(4)
        : fromNumber;
      const sheetId = await ensureSheet({
        sheets: google.sheets,
        spreadsheetId: google.sheetId,
        title: APPELS_SHEET_TITLE,
        headers: APPELS_HEADERS,
      });
      await prependRow({
        sheets: google.sheets,
        spreadsheetId: google.sheetId,
        sheetId,
        sheetTitle: APPELS_SHEET_TITLE,
        newRow: [
          date,
          heure,
          "", // caller name pas connu ici (l'agent ne le passe pas) — vide
          forceTextPhone(localFromNumber),
          durFormatted,
          callType,
          summary.forOwner.slice(0, 500), // truncate pour pas saturer la cellule
        ],
      });
      await logEvent({
        source: "sheets",
        event: "call_log_added",
        message: `Appel loggé dans Sheets : ${localFromNumber || "?"} · ${callType}`,
        userId: user.id,
        metadata: { callId: callRow.id, type: callType },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sheets failed";
    await logEvent({
      source: "sheets",
      event: "call_log_failed",
      message: `Push Appels échoué : ${msg.slice(0, 200)}`,
      level: "error",
      userId: user.id,
      metadata: { callId: callRow.id, error: msg },
    });
  }

  return NextResponse.json({
    ok: true,
    callId: callRow.id,
    tenant: { id: user.id, email: user.email, displayName: user.displayName },
    summary: summary.raw,
    delivered: { client: !!clientSid, owner: !!ownerSid },
    error: waError,
  });
}
