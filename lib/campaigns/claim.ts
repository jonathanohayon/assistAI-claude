// Claim atomique des contacts à appeler — partagé par le contrat worker-poll
// (/api/agent/campaign-jobs) et le dispatcher web cron (/api/cron/campaign-
// dispatch). SERVER-ONLY.

import { inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import type { CampaignPersona, ExtractionField } from "./constants";

const STALE_CLAIM_MINUTES = 10;

export type CampaignJob = {
  contactId: string;
  campaignId: string;
  userId: string;
  phoneNumber: string;
  contactName: string;
  vars: Record<string, string>;
  attempts: number;
  fromNumber: string;
  persona: CampaignPersona;
  objective: string;
  successCriteria: string;
  extractionSchema: ExtractionField[];
  language: string;
};

type ClaimedRow = {
  id: string;
  campaign_id: string;
  phone_number: string;
  contact_name: string;
  vars: Record<string, string>;
  attempts: number;
};

// Réclame jusqu'à `limit` contacts, en respectant status running, fenêtre
// d'appel (timezone), concurrence par campagne, et l'anti-double-dial
// (FOR UPDATE SKIP LOCKED). Reaper des claims périmés au passage.
export async function claimCampaignJobs(limit: number): Promise<CampaignJob[]> {
  const n = Math.min(Math.max(Math.round(limit) || 1, 1), 50);

  await db.execute(sql`
    UPDATE campaign_contacts
    SET status = 'queued', claimed_at = NULL
    WHERE status = 'claimed'
      AND claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval
  `);

  const claimed = (await db.execute(sql`
    WITH running AS (
      SELECT
        c.id,
        c.concurrency - COALESCE((
          SELECT count(*) FROM campaign_contacts i
          WHERE i.campaign_id = c.id AND i.status IN ('claimed','calling')
        ), 0) AS slots
      FROM campaigns c
      WHERE c.status = 'running'
        AND EXTRACT(DOW FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            IN (SELECT jsonb_array_elements_text(c.call_window->'days')::int)
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            >= (c.call_window->>'startHour')::int
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            < (c.call_window->>'endHour')::int
    ),
    picked AS (
      SELECT cc.id
      FROM running r
      CROSS JOIN LATERAL (
        SELECT cc.id
        FROM campaign_contacts cc
        WHERE cc.campaign_id = r.id
          AND cc.status = 'queued'
          AND (cc.next_attempt_at IS NULL OR cc.next_attempt_at <= now())
        ORDER BY cc.created_at
        LIMIT GREATEST(r.slots, 0)
        FOR UPDATE SKIP LOCKED
      ) cc
      WHERE r.slots > 0
      LIMIT ${n}
    )
    UPDATE campaign_contacts cc
    SET status = 'claimed', claimed_at = now(), attempts = attempts + 1
    WHERE cc.id IN (SELECT id FROM picked)
    RETURNING cc.id, cc.campaign_id, cc.phone_number, cc.contact_name, cc.vars, cc.attempts
  `)) as unknown as ClaimedRow[];

  if (!claimed.length) return [];

  const campaignIds = Array.from(new Set(claimed.map((c) => c.campaign_id)));
  const campRows = await db
    .select()
    .from(campaigns)
    .where(inArray(campaigns.id, campaignIds));
  const campMap = new Map(campRows.map((c) => [c.id, c]));

  return claimed
    .map((row): CampaignJob | null => {
      const c = campMap.get(row.campaign_id);
      if (!c) return null;
      return {
        contactId: row.id,
        campaignId: row.campaign_id,
        userId: c.userId,
        phoneNumber: row.phone_number,
        contactName: row.contact_name,
        vars: row.vars ?? {},
        attempts: row.attempts,
        fromNumber: c.fromNumber,
        persona: c.persona,
        objective: c.objective,
        successCriteria: c.persona?.successCriteria ?? "",
        extractionSchema: c.extractionSchema,
        language: c.persona?.language ?? "fr",
      };
    })
    .filter((j): j is CampaignJob => j !== null);
}

// Repose un contact en file (utilisé si le dial échoue côté dispatcher avant
// même que le worker ne prenne la main → pas de campaign_calls inséré).
export async function requeueContact(contactId: string): Promise<void> {
  await db.execute(sql`
    UPDATE campaign_contacts
    SET status = 'queued', claimed_at = NULL
    WHERE id = ${contactId} AND status IN ('claimed','calling')
  `);
}
