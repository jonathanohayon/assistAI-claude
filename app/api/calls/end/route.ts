import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { summarizeCall } from "@/lib/summarize";
import { resolveTenant } from "@/lib/tenant";
import { sendWhatsApp } from "@/lib/whatsapp";

interface EndBody {
  fromNumber?: string;
  toNumber?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
}

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
    summary = await summarizeCall(transcript);
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

  if (fromNumber) {
    const r = await sendWhatsApp({ to: fromNumber, body: summary.forClient });
    if (r.ok && r.sid) {
      clientSid = r.sid;
      await logEvent({
        source: "whatsapp",
        event: "whatsapp_sent_client",
        message: `WhatsApp envoyé à la cliente ${fromNumber}`,
        userId: user.id,
        metadata: { callId: callRow.id, sid: r.sid, to: fromNumber },
      });
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

  if (cfg.ownerWhatsapp) {
    const ownerBody = `📞 Nouvel appel reçu\n\n${summary.forOwner}\n\n— ${fromNumber || "numéro inconnu"}`;
    const r = await sendWhatsApp({
      to: cfg.ownerWhatsapp,
      body: ownerBody,
      ownerTemplateFallback: true,
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

  return NextResponse.json({
    ok: true,
    callId: callRow.id,
    tenant: { id: user.id, email: user.email, displayName: user.displayName },
    summary: summary.raw,
    delivered: { client: !!clientSid, owner: !!ownerSid },
    error: waError,
  });
}
