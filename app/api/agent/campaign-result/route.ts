import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { campaignCalls, campaignContacts, campaigns } from "@/lib/db/schema";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/campaigns/constants";
import { logEvent } from "@/lib/logger";

// POST /api/agent/campaign-result  (x-internal-secret)
// Body: { campaignId, contactId, outcome, transcript?, durationSeconds? }
// Enregistre l'appel, fait transitionner le contact (retry ou statut terminal),
// et complète la campagne quand il ne reste plus de contacts en vol.

const OUTCOME_TO_STATUS: Record<CallOutcome, string> = {
  connected: "completed",
  no_answer: "no_answer",
  voicemail: "voicemail",
  busy: "busy",
  failed: "failed",
};

interface Body {
  campaignId?: string;
  contactId?: string;
  outcome?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
  durationSeconds?: number;
}

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<Body>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const campaignId = body.campaignId ?? "";
  const contactId = body.contactId ?? "";
  if (!campaignId || !contactId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }
  const outcome: CallOutcome = CALL_OUTCOMES.includes(body.outcome as CallOutcome)
    ? (body.outcome as CallOutcome)
    : "failed";
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const durationSeconds =
    typeof body.durationSeconds === "number" && body.durationSeconds >= 0
      ? Math.round(body.durationSeconds)
      : 0;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }
  const [contact] = await db
    .select()
    .from(campaignContacts)
    .where(eq(campaignContacts.id, contactId))
    .limit(1);
  if (!contact) {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  }

  await db.insert(campaignCalls).values({
    campaignId,
    contactId,
    userId: campaign.userId,
    phoneNumber: contact.phoneNumber,
    outcome,
    transcript,
    durationSeconds,
  });

  // Retry si l'issue est dans retryOn et qu'il reste des tentatives.
  const rules = campaign.retryRules ?? { maxAttempts: 1, retryOn: [], backoffMinutes: 30 };
  const shouldRetry =
    rules.retryOn?.includes(outcome as "no_answer" | "busy" | "voicemail" | "failed") &&
    contact.attempts < (rules.maxAttempts ?? 1);

  if (shouldRetry) {
    await db
      .update(campaignContacts)
      .set({
        status: "queued",
        claimedAt: null,
        nextAttemptAt: sql`now() + (${rules.backoffMinutes ?? 30} || ' minutes')::interval`,
      })
      .where(eq(campaignContacts.id, contactId));
  } else {
    await db
      .update(campaignContacts)
      .set({ status: OUTCOME_TO_STATUS[outcome], claimedAt: null })
      .where(eq(campaignContacts.id, contactId));
  }

  // Auto-complétion de la campagne si plus rien en vol.
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
    message: `Appel campagne ${outcome} — ${contact.phoneNumber}`,
    userId: campaign.userId,
    metadata: { campaignId, contactId, outcome, durationSeconds },
  });

  return NextResponse.json({ ok: true });
}
