import { and, eq, gt, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { callTypeForCall } from "@/lib/call-type-db";
import { callIdFromRequest } from "@/lib/call-id";
import { markForwardingTestCall } from "@/lib/forwarding-test-db";
import { getTranslations } from "next-intl/server";
import { sendOwnerRecapEmailBestEffort } from "@/lib/owner-recap-email-send";
import { sendOwnerRecapWhatsApp, toRecapLocale } from "@/lib/owner-recap-whatsapp";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { callInsertValues, parseCallEndBody } from "@/lib/call-end-body";
import { db } from "@/lib/db";
import { calls, events } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { clientConfirmDeps } from "@/lib/client-confirm/deps";
import { sendClientConfirm } from "@/lib/client-confirm/run";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { DEFAULT_PLAN_KEY, isValidPlanKey, type PlanKey } from "@/lib/plans";
import { tenantCallNumber } from "@/lib/tenant-call-number";
import { getSummaryPromptByPlan } from "@/lib/settings";
import {
  ensureSheet,
  forceTextPhone,
  prependRow,
} from "@/lib/sheets-helpers";
import { summarizeCall, summarySignature } from "@/lib/summarize";
import { resolveTenant, resolveTenantByUserId } from "@/lib/tenant";
import { checkTwilioMessageStatus } from "@/lib/whatsapp";

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
  /** null = not logged (the client's number never goes into events). */
  to: string | null,
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
      message: `WhatsApp ${recipient} non livré${to ? ` à ${to}` : ""} (status=${status.status}${
        status.errorCode ? ` code=${status.errorCode}` : ""
      })${status.errorMessage ? ` : ${status.errorMessage.slice(0, 150)}` : ""}`,
      level: "error",
      userId,
      metadata: to ? { callId, sid, to, ...status } : { callId, sid, ...status },
    });
  }
}

/**
 * Heuristique pour déduire le TYPE d'appel à partir du résumé / transcript :
 * RDV, Annulation, Modification, Message, ou Info. Affichage Sheets only.
 */

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) {
    await logEvent({
      source: "web",
      event: "calls_end_forbidden",
      message: "Tentative d'accès non autorisée à /api/calls/end",
      level: "warn",
    });
    return auth.response;
  }

  const parsed = parseCallEndBody(await req.json().catch(() => ({})));
  const { fromNumber, toNumber, userId, channel, transcript, durationSeconds, callId: bodyCallId } = parsed;
  // Call id (LiveKit room name): body field or the x-call-id header the worker
  // sends with every request. Ties this call to its own tool events.
  const callId = bodyCallId ?? callIdFromRequest(req);

  // userId prioritaire (chemin web LiveTest Phase 2) → exact match par PK.
  // Sinon, toNumber (chemin SIP Twilio) → phone_numbers → tenant.
  // Sinon, default tenant — uniquement pour la rétro-compat des très vieux
  // appels où ni userId ni toNumber n'arrivent (devrait plus arriver).
  const tenant = userId
    ? await resolveTenantByUserId(userId)
    : await resolveTenant(toNumber || null, "calls_end");
  if (!tenant) {
    await logEvent({
      source: "tenant",
      event: "tenant_not_found",
      message: `Aucun tenant pour userId=${userId || "(none)"} toNumber=${toNumber || "(none)"}`,
      level: "error",
      metadata: { userId, toNumber },
    });
    return NextResponse.json({ error: "no tenant" }, { status: 500 });
  }
  // Forwarding setup check, fallback path (call start may have caught it
  // already). Phone calls only: not the web LiveTest, not WhatsApp calls.
  if (!userId && channel !== "whatsapp") {
    await markForwardingTestCall(tenant.user.id, { via: "call_end" });
  }
  const { user, config: cfg } = tenant;

  const [callRow] = await db
    .insert(calls)
    .values(callInsertValues(parsed, user.id, callId))
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
    // Signed with the tenant's OWN business name (company sheet, read from
    // agent_configs.business), or not signed at all when it has none.
    summary = await summarizeCall(transcript, customPrompt, targetLang, summarySignature(cfg.business));
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
      .set({
        whatsappError: `summary: ${msg}`,
        callType: await callTypeForCall({
          userId: user.id,
          endedAt: callRow.createdAt,
          callId,
          durationSeconds: durationSeconds ?? 0,
          summary: "",
          transcript: transcript.map((t) => t.text),
        }),
      })
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

  // Call type: deterministic tool events first, keywords as fallback.
  const callType = await callTypeForCall({
    userId: user.id,
    endedAt: callRow.createdAt,
    callId,
    durationSeconds: durationSeconds ?? 0,
    summary: summary.raw,
    transcript: transcript.map((t) => t.text),
  });
  await db
    .update(calls)
    .set({ summary: summary.raw, callType })
    .where(eq(calls.id, callRow.id));

  let clientSid: string | null = null;
  let ownerSid: string | null = null;
  let waError: string | null = null;

  // Matrice features (admin/Réglages partagés) → décide si on envoie le
  // recap client (whatsapp_confirm) et/ou le recap owner (whatsapp_recap).
  // Read une fois par appel : c'est négligeable vs. le coût de l'appel.
  const planMatrix = await getPlanFeatureMatrix();
  const tenantFeatures = featuresForPlan(planMatrix, user.subscriptionPlan);

  // Client confirm: ONLY after a PROVEN booking / cancel / reschedule of this
  // call, with a text built from that tool event (never the model's recap:
  // the caller ID can be spoofed). One per destination per call, at most 3
  // per number per day. lib/client-confirm/run.ts.
  //
  // PSTN: the per-language approved template (WHATSAPP_CLIENT_TEMPLATE_SID_<LANG>,
  // else the legacy SID), only its {{1}} value is ours. WhatsApp channel: the
  // 24 h window is open (the caller just reached us there) → free-form.
  {
    const isWhatsappChannel = channel === "whatsapp";
    const tenantLang = (cfg.primaryLanguage ?? "fr").toUpperCase();
    const langKey = `WHATSAPP_CLIENT_TEMPLATE_SID_${tenantLang}`;
    const clientTemplate = isWhatsappChannel
      ? undefined
      : process.env[langKey] || process.env.WHATSAPP_CLIENT_TEMPLATE_SID;
    const confirm = await sendClientConfirm(
      {
        userId: user.id,
        call: {
          id: callRow.id,
          userId: user.id,
          callId: callRow.callId ?? "",
          createdAt: callRow.createdAt,
          durationSeconds: callRow.durationSeconds ?? 0,
        },
        fromNumber,
        enabled: tenantFeatures.whatsapp_confirm !== false,
        channel,
        lang: cfg.primaryLanguage ?? "fr",
        signature: summarySignature(cfg.business),
        callNumber: () => tenantCallNumber(user.id, toNumber || null),
        templateSid: clientTemplate || undefined,
      },
      clientConfirmDeps,
    );
    if (confirm.sent) {
      clientSid = confirm.sid;
      void verifyDelivery(confirm.sid, "client", null, user.id, callRow.id);
    } else if (confirm.reason === "send_failed") {
      waError = `client: ${confirm.error}`;
    }
  }

  // Dedup proprio : on évite de spammer le proprio si :
  //   (a) un message LIVRÉ AVEC SUCCÈS récent existe (5 min) → cas où
  //       l'appelant·e a appelé plusieurs fois (reconnect, retry, ou
  //       call glitché qui s'est terminé prématurément). 2 recaps quasi
  //       identiques sont du noise.
  //   (b) transcript trop court (≤ 1 entry = juste le greeting agent,
  //       souvent un crash/instant-hangup) — rien d'utile à recap.
  //
  // ⚠️ Important 2026-05-14 : on doit EXCLURE les `whatsapp_sent_owner`
  // qui ont un `whatsapp_undelivered_owner` postérieur (Twilio accepte 201
  // puis Meta refuse hors fenêtre 24h, code 63016). Sinon le 1er appel
  // log un "sent" jamais livré, et tous les appels suivants sont skip
  // alors que le proprio n'a JAMAIS rien reçu.
  //
  // notify_sent reste dans la liste pour les events historiques de
  // l'ancien tool take_message (retiré 2026-05-13) ; aucun nouveau event
  // de ce type n'est plus émis.
  const dedupCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const recentOwnerEvents = await db
    .select({
      event: events.event,
      metadata: events.metadata,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, user.id),
        eq(events.source, "whatsapp"),
        inArray(events.event, [
          "notify_sent",
          "whatsapp_sent_owner",
          "whatsapp_undelivered_owner",
        ]),
        gt(events.createdAt, dedupCutoff),
      ),
    );
  // Compte les SIDs marqués undelivered : ces envois n'ont jamais atteint
  // le proprio, donc ne doivent pas déclencher le dedup.
  const undeliveredSids = new Set<string>();
  for (const e of recentOwnerEvents) {
    if (e.event !== "whatsapp_undelivered_owner") continue;
    const sid = (e.metadata as { sid?: string } | null)?.sid;
    if (sid) undeliveredSids.add(sid);
  }
  const recentOwnerMessageExists = recentOwnerEvents.some((e) => {
    if (e.event === "whatsapp_undelivered_owner") return false;
    if (e.event === "notify_sent") return true; // legacy, pas de verifyDelivery
    // whatsapp_sent_owner : ignore si SID dans undeliveredSids
    const sid = (e.metadata as { sid?: string } | null)?.sid;
    return !sid || !undeliveredSids.has(sid);
  });
  const tooShortToRecap = transcript.length <= 1;

  const skipOwnerReason = recentOwnerMessageExists
    ? "dedup_recent_owner_message"
    : tooShortToRecap
      ? "transcript_too_short"
      : null;

  if (
    cfg.ownerWhatsapp &&
    tenantFeatures.whatsapp_recap !== false &&
    skipOwnerReason !== null
  ) {
    // Trace explicite pour qu'on sache pourquoi le proprio n'a pas reçu
    // de recap post-appel — sinon ça ressemble à un bug silencieux.
    await logEvent({
      source: "whatsapp",
      event: "whatsapp_skipped_owner_dedup",
      message: `Recap proprio sauté (${skipOwnerReason}) — to=${cfg.ownerWhatsapp}, transcript=${transcript.length} entries`,
      userId: user.id,
      metadata: {
        callId: callRow.id,
        to: cfg.ownerWhatsapp,
        reason: skipOwnerReason,
        transcriptEntries: transcript.length,
      },
    });
  }

  if (
    cfg.ownerWhatsapp &&
    tenantFeatures.whatsapp_recap !== false &&
    skipOwnerReason === null
  ) {
    // Wrapper in the tenant's language (same strings as the owner recap
    // email); template SID per language, unchanged (lib/owner-recap-whatsapp).
    const recapLocale = toRecapLocale(cfg.primaryLanguage);
    const tRecap = await getTranslations({ locale: recapLocale, namespace: "Email.ownerRecap" });
    const r = await sendOwnerRecapWhatsApp(
      {
        to: cfg.ownerWhatsapp,
        forOwner: summary.forOwner,
        fromNumber,
        primaryLanguage: cfg.primaryLanguage,
      },
      (key, vars) => tRecap(key, vars),
    );
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

  // Owner recap by EMAIL, next to the WhatsApp one: only when the owner
  // switched it on AND set an address (default OFF). Fire-and-forget like
  // verifyDelivery: never awaited, never throws, never changes the response.
  void sendOwnerRecapEmailBestEffort({
    userId: user.id,
    callId: callRow.id,
    cfg,
    forOwner: summary.forOwner,
    fromNumber,
    recapFeatureOn: tenantFeatures.whatsapp_recap !== false,
    transcriptEntries: transcript.length,
  });

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
      const dur = durationSeconds;
      const durFormatted =
        typeof dur === "number" && dur > 0
          ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`
          : "";
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
