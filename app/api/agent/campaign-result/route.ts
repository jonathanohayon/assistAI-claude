import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  campaignCalls,
  campaignContacts,
  campaigns,
} from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/campaigns/constants";
import { analyzeCampaignCall } from "@/lib/campaigns/analyze";

export const dynamic = "force-dynamic";

// Mappe l'issue d'appel vers le statut terminal du contact.
const OUTCOME_TO_STATUS: Record<CallOutcome, string> = {
  connected: "completed",
  no_answer: "no_answer",
  voicemail: "voicemail",
  busy: "busy",
  failed: "failed",
};

// POST — réservé au worker (x-internal-secret). Enregistre le résultat d'un
// appel de campagne : analyse IA (résumé + disposition + sentiment +
// extraction), insertion campaign_calls, transition du contact (terminal ou
// requeue selon les retry rules), et auto-complétion de la campagne.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    contactId?: string;
    campaignId?: string;
    outcome?: string;
    transcript?: Array<{ role: "user" | "assistant"; text: string }>;
    durationSeconds?: number;
  };

  const { contactId, campaignId } = body;
  if (!contactId || !campaignId)
    return NextResponse.json({ error: "missing_ids" }, { status: 400 });

  const outcome: CallOutcome = CALL_OUTCOMES.includes(body.outcome as CallOutcome)
    ? (body.outcome as CallOutcome)
    : "failed";
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds) || 0));

  // Charge le contact + la campagne (cohérence campaignId/contactId).
  const [contact] = await db
    .select()
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
      ),
    )
    .limit(1);
  if (!contact)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });

  // Analyse IA uniquement si l'appel a abouti (transcript exploitable).
  const analysis =
    outcome === "connected" && transcript.length
      ? await analyzeCampaignCall({
          transcript,
          objective: campaign.objective,
          successCriteria: campaign.persona?.successCriteria,
          extractionSchema: campaign.extractionSchema,
          language: campaign.persona?.language ?? "fr",
        })
      : { summary: "", disposition: "" as const, sentiment: "" as const, extracted: {} };

  // Enregistre l'appel.
  await db.insert(campaignCalls).values({
    campaignId,
    contactId,
    userId: campaign.userId,
    phoneNumber: contact.phoneNumber,
    outcome,
    disposition: analysis.disposition,
    sentiment: analysis.sentiment,
    summary: analysis.summary,
    transcript,
    extracted: analysis.extracted,
    durationSeconds,
  });

  // Transition du contact : requeue si l'issue est dans retryOn et qu'il reste
  // des tentatives, sinon statut terminal.
  const rules = campaign.retryRules;
  const shouldRetry =
    outcome !== "connected" &&
    rules.retryOn.includes(outcome as never) &&
    contact.attempts < rules.maxAttempts;

  if (shouldRetry) {
    await db
      .update(campaignContacts)
      .set({
        status: "queued",
        claimedAt: null,
        nextAttemptAt: sql`now() + (${rules.backoffMinutes} || ' minutes')::interval`,
      })
      .where(eq(campaignContacts.id, contactId));
  } else {
    await db
      .update(campaignContacts)
      .set({ status: OUTCOME_TO_STATUS[outcome], claimedAt: null })
      .where(eq(campaignContacts.id, contactId));
  }

  // Auto-complétion : si plus aucun contact en file/en vol, on clôt la campagne.
  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.campaignId, campaignId),
        sql`status IN ('queued','claimed','calling')`,
      ),
    );
  if ((remaining?.n ?? 0) === 0 && campaign.status === "running") {
    await db
      .update(campaigns)
      .set({ status: "completed", completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(campaigns.id, campaignId));
  }

  await logEvent({
    source: "agent",
    event: "campaign_call_done",
    message: `Appel campagne ${campaign.name} → ${outcome}${analysis.disposition ? ` (${analysis.disposition})` : ""}`,
    userId: campaign.userId,
    metadata: {
      campaignId,
      contactId,
      outcome,
      disposition: analysis.disposition,
      retried: shouldRetry,
    },
  });

  return NextResponse.json({
    ok: true,
    outcome,
    disposition: analysis.disposition,
    retried: shouldRetry,
  });
}
