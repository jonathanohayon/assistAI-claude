import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { campaignContacts } from "@/lib/db/schema";
import { isCallState, shouldApplyCallState } from "@/lib/campaigns/live";
import { logEvent } from "@/lib/logger";

// POST /api/agent/campaign-progress  (x-internal-secret)
// Body: { campaignId, contactId, state: "dialing"|"ringing"|"in_call"|"ended",
//         sipStatus?, durationSeconds? }
// Live call progress from the worker, for the admin campaign console. The
// terminal outcome still comes through /api/agent/campaign-result.

interface Body {
  campaignId?: string;
  contactId?: string;
  state?: string;
  sipStatus?: string;
  durationSeconds?: number;
}

const MESSAGES: Record<string, string> = {
  dialing: "Dialling",
  ringing: "Ringing",
  in_call: "Answered, in call",
  ended: "Call ended",
};

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<Body>(req);
  if (!parsed.ok) return parsed.response;
  const { campaignId = "", contactId = "", state } = parsed.data;
  if (!campaignId || !contactId || !isCallState(state)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const [contact] = await db
    .select({
      userId: campaignContacts.userId,
      phoneNumber: campaignContacts.phoneNumber,
      callState: campaignContacts.callState,
    })
    .from(campaignContacts)
    .where(and(eq(campaignContacts.id, contactId), eq(campaignContacts.campaignId, campaignId)))
    .limit(1);
  if (!contact) {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  }

  const applied = shouldApplyCallState(contact.callState, state);
  if (applied) {
    await db
      .update(campaignContacts)
      .set({ callState: state, callStateAt: sql`now()` })
      .where(eq(campaignContacts.id, contactId));
  }

  const durationSeconds =
    typeof parsed.data.durationSeconds === "number" && parsed.data.durationSeconds >= 0
      ? Math.round(parsed.data.durationSeconds)
      : undefined;
  const sipStatus = typeof parsed.data.sipStatus === "string" ? parsed.data.sipStatus.slice(0, 64) : undefined;

  await logEvent({
    source: "agent",
    event: "campaign_call_progress",
    message: `${MESSAGES[state]} — ${contact.phoneNumber}${durationSeconds !== undefined ? ` (${durationSeconds}s)` : ""}`,
    userId: contact.userId,
    metadata: { campaignId, contactId, state, sipStatus, durationSeconds, applied },
  });

  return NextResponse.json({ ok: true, applied });
}
