import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignContacts, campaigns, phoneNumbers } from "@/lib/db/schema";
import { dialOneNow } from "@/lib/campaigns/dispatch";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { logEvent } from "@/lib/logger";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/dashboard/campaigns/[id]/test-call  body { phoneNumber }
// Compose UN appel test immédiat vers `phoneNumber` via la persona de la
// campagne, en BYPASSANT la fenêtre horaire et la file. Crée un contact de
// test (vars.__test) pour que le worker puisse fetch campaign-config + poster
// le résultat normalement.

const E164 = /^\+[1-9]\d{6,14}$/;

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = await parseJsonBody<{ phoneNumber?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const phoneNumber = (body.phoneNumber ?? "").trim();
  if (!E164.test(phoneNumber)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Caller-id : numéro de la campagne, sinon 1er numéro du tenant.
  let fromNumber = campaign.fromNumber?.trim() || "";
  if (!fromNumber) {
    const [num] = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, r.userId))
      .limit(1);
    fromNumber = num?.phoneNumber ?? "";
  }
  if (!fromNumber) {
    return NextResponse.json({ error: "no_caller_id" }, { status: 409 });
  }

  // Contact de test marqué (status 'calling' → ignoré par le dispatcher).
  const [contact] = await db
    .insert(campaignContacts)
    .values({
      campaignId: id,
      userId: r.userId,
      phoneNumber,
      contactName: "Test",
      vars: { __test: "true" },
      status: "calling",
      attempts: 1,
    })
    .returning({ id: campaignContacts.id });

  try {
    const { roomName } = await dialOneNow({
      phoneNumber,
      fromNumber,
      campaignId: id,
      contactId: contact.id,
      userId: r.userId,
    });
    await logEvent({
      source: "web",
      event: "campaign_test_call",
      message: `Appel test immédiat → ${phoneNumber} (caller-id ${fromNumber})`,
      userId: r.userId,
      metadata: { campaignId: id, contactId: contact.id, roomName },
    });
    return NextResponse.json({ ok: true, roomName });
  } catch (e) {
    await db
      .update(campaignContacts)
      .set({ status: "failed" })
      .where(eq(campaignContacts.id, contact.id));
    return NextResponse.json(
      { error: "dial_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 502 },
    );
  }
}
