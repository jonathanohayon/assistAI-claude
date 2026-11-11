import { and, desc, eq, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { campaignContacts, campaigns, events } from "@/lib/db/schema";
import {
  campaignBlockers,
  contactRank,
  DISPATCH_TICK_KEY,
  isInCallWindow,
  type CallWindow,
  type DispatchTick,
} from "@/lib/campaigns/live";
import { dispatchMode } from "@/lib/campaigns/dispatch-mode";
import { campaignEventsWhere, eventContactId } from "@/lib/campaigns/live-events";
import { getSetting } from "@/lib/settings";

interface Ctx {
  params: Promise<{ id: string }>;
}

const CONTACT_LIMIT = 500;
const EVENT_LIMIT = 100;

// GET /api/dashboard/campaigns/:id/live?since=<ISO>
// Admin-only live console for an outbound campaign. Cheap enough to poll
// every 2-3 s: 4 indexed queries, no LLM, no external call. `since` limits
// `events` to newer rows (incremental feed); everything else is a snapshot.
export async function GET(req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await ctx.params;
  const [campaign] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      concurrency: campaigns.concurrency,
      callWindow: campaigns.callWindow,
      fromNumber: campaigns.fromNumber,
      startedAt: campaigns.startedAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;
  const now = new Date();

  const [contactRows, eventRows, tickRaw] = await Promise.all([
    db
      .select({
        id: campaignContacts.id,
        phoneNumber: campaignContacts.phoneNumber,
        contactName: campaignContacts.contactName,
        status: campaignContacts.status,
        callState: campaignContacts.callState,
        callStateAt: campaignContacts.callStateAt,
        attempts: campaignContacts.attempts,
        nextAttemptAt: campaignContacts.nextAttemptAt,
        claimedAt: campaignContacts.claimedAt,
      })
      .from(campaignContacts)
      .where(eq(campaignContacts.campaignId, id)),
    db
      .select({
        id: events.id,
        at: events.createdAt,
        event: events.event,
        level: events.level,
        message: events.message,
        metadata: events.metadata,
      })
      .from(events)
      .where(
        and(
          // Web events (top-level campaignId) AND worker events (metadata.origin).
          campaignEventsWhere(id),
          since ? gt(events.createdAt, since) : undefined,
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(EVENT_LIMIT),
    getSetting(DISPATCH_TICK_KEY),
  ]);

  const counts: Record<string, number> = {};
  let inFlight = 0;
  let dueQueued = 0;
  for (const c of contactRows) {
    counts[c.status] = (counts[c.status] ?? 0) + 1;
    if (c.status === "claimed" || c.status === "calling") inFlight++;
    if (c.status === "queued" && (!c.nextAttemptAt || c.nextAttemptAt <= now)) dueQueued++;
  }

  const callWindow = campaign.callWindow as CallWindow;
  let lastTick: DispatchTick | null = null;
  try {
    lastTick = tickRaw ? (JSON.parse(tickRaw) as DispatchTick) : null;
  } catch {
    lastTick = null;
  }

  const contacts = contactRows
    .map((c) => ({
      contactId: c.id,
      phoneNumber: c.phoneNumber,
      name: c.contactName,
      status: c.status,
      callState: c.callState,
      callStateAt: c.callStateAt?.toISOString() ?? null,
      attempts: c.attempts,
      nextAttemptAt: c.nextAttemptAt?.toISOString() ?? null,
    }))
    .sort((a, b) => contactRank(a.status, a.callState) - contactRank(b.status, b.callState));

  return NextResponse.json({
    now: now.toISOString(),
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      concurrency: campaign.concurrency,
      fromNumber: campaign.fromNumber,
      startedAt: campaign.startedAt?.toISOString() ?? null,
      callWindow,
      inCallWindow: isInCallWindow(callWindow, now),
    },
    counts,
    dispatcher: {
      // CAMPAIGN_DISPATCH as a viewer-safe word (never the env name/value).
      dispatchMode: dispatchMode(),
      lastTick,
      // Live, not from the last tick: what would block a dial right now.
      blockers: campaignBlockers(
        {
          status: campaign.status,
          callWindow,
          concurrency: campaign.concurrency,
          inFlight,
          dueQueued,
        },
        now,
      ),
      inFlight,
      dueQueued,
    },
    inProgress: contacts.filter((c) => c.status === "calling" || c.status === "claimed"),
    contacts: contacts.slice(0, CONTACT_LIMIT),
    contactsTotal: contacts.length,
    events: eventRows.map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      event: e.event,
      level: e.level,
      message: e.message,
      contactId: eventContactId(e.metadata),
      data: e.metadata,
    })),
  });
}
