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

/**
 * Worker events that are diagnostic-only or bulky, hidden from the console
 * so they neither take slots in its event window nor ship their metadata.
 * Applies to the worker-origin branch only, and never to level = 'error'.
 * Names from `remoteLog(` calls in the worker (agent.ts, src/region-probe.ts).
 */
export const WORKER_CONSOLE_NOISE = [
  "chatctx_snapshot", // full chat context dump, 8-12 kB metadata, once per call
  "config_loaded", // resolved tenant config at call start
  "call_metrics", // latency summary at call end
  "connect_phases", // connection timing breakdown at call start
  "realtime_provider", // which realtime engine/model was picked
  "business_tools_registered", // tool registration list
  "knowledge_tools_registered", // tool registration list
  "realtime_session_shutdown", // provider teardown result at call end
  "infra_region_probe", // worker region probe, infra diagnostics
] as const;

export function campaignEventsWhere(campaignId: string): SQL {
  const noise = sql.join(
    WORKER_CONSOLE_NOISE.map((e) => sql`${e}`),
    sql`, `,
  );
  return sql`(
    (${events.metadata} ? 'campaignId' AND (${events.metadata}->>'campaignId') = ${campaignId})
    OR ((${events.metadata}->'origin'->>'kind') = 'campaign'
        AND (${events.metadata}->'origin'->>'campaignId') = ${campaignId}
        AND (${events.level} = 'error' OR ${events.event} NOT IN (${noise})))
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
