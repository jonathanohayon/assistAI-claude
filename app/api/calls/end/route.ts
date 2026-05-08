import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { summarizeCall } from "@/lib/summarize";
import { resolveTenant } from "@/lib/tenant";
import { sendWhatsApp } from "@/lib/whatsapp";

interface EndBody {
  fromNumber?: string;
  toNumber?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
}

// Internal endpoint hit by the LiveKit agent worker when a call ends.
// Auth via shared INTERNAL_SECRET header.
//
// Multi-tenant: looks up the tenant via the called number (`toNumber`).
// Falls back to the first tenant if not provided / not matched.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as EndBody;
  const fromNumber = (body.fromNumber ?? "").trim();
  const toNumber = (body.toNumber ?? "").trim();
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];

  const tenant = await resolveTenant(toNumber || null);
  if (!tenant) {
    return NextResponse.json({ error: "no tenant" }, { status: 500 });
  }
  const { user, config: cfg } = tenant;

  const [callRow] = await db
    .insert(calls)
    .values({ userId: user.id, fromNumber, transcript, summary: "" })
    .returning();

  if (transcript.length === 0) {
    return NextResponse.json({
      ok: true,
      callId: callRow.id,
      skipped: "empty transcript",
    });
  }

  let summary;
  try {
    summary = await summarizeCall(transcript);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "summary failed";
    await db
      .update(calls)
      .set({ whatsappError: `summary: ${msg}` })
      .where(eq(calls.id, callRow.id));
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
    if (r.ok && r.sid) clientSid = r.sid;
    else waError = `client: ${r.error}`;
  }

  if (cfg.ownerWhatsapp) {
    const ownerBody = `📞 Nouvel appel reçu\n\n${summary.forOwner}\n\n— ${fromNumber || "numéro inconnu"}`;
    const r = await sendWhatsApp({
      to: cfg.ownerWhatsapp,
      body: ownerBody,
      ownerTemplateFallback: true,
    });
    if (r.ok && r.sid) ownerSid = r.sid;
    else waError = (waError ? waError + " | " : "") + `owner: ${r.error}`;
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
