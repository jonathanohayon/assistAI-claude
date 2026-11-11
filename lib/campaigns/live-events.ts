// Live campaign console: which `events` rows belong to one campaign.
// Server-only (drizzle SQL). Tested in scripts/tests/live-console-events.test.ts.
//
// Two stored shapes carry a campaign, both kept as-is by lib/logger.ts:
//   1. Web-side events (dispatch, campaign-progress, test-call, status,
//      contacts): metadata.campaignId at the top level.
//   2. Worker events posted through remoteLog (call_started, call_transfer,
//      config_loaded, auto_hangup, realtime errors...): no top-level
//      campaignId; the campaign is in metadata.origin =
//      { kind: 'campaign', campaignId, contactId, userId } and the call in
//      metadata.callId.
// Each branch is written so it matches its partial index
// (events_campaign_created_idx / events_origin_campaign_created_idx).

import { sql, type SQL } from "drizzle-orm";

import { events } from "@/lib/db/schema";

export function campaignEventsWhere(campaignId: string): SQL {
  return sql`(
    (${events.metadata} ? 'campaignId' AND (${events.metadata}->>'campaignId') = ${campaignId})
    OR ((${events.metadata}->'origin'->>'kind') = 'campaign'
        AND (${events.metadata}->'origin'->>'campaignId') = ${campaignId})
  )`;
}

/** The contact an event is about: top-level contactId, else the worker's origin.contactId. */
export function eventContactId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.contactId === "string" && m.contactId) return m.contactId;
  const origin = m.origin;
  if (origin && typeof origin === "object") {
    const o = origin as Record<string, unknown>;
    if (o.kind === "campaign" && typeof o.contactId === "string" && o.contactId) return o.contactId;
  }
  return null;
}
