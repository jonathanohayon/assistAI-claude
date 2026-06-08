// Réclamation atomique des contacts à appeler — SERVER-ONLY.
//
// Sélectionne les contacts `queued` de campagnes `running` qui respectent :
// la fenêtre horaire (jour/heure en timezone campagne), la concurrence par
// campagne, et le backoff (next_attempt_at). FOR UPDATE SKIP LOCKED évite le
// double-claim entre dispatchers concurrents. Reseed les claims périmés (>10 min).

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export interface CampaignJob {
  contactId: string;
  campaignId: string;
  userId: string;
  phoneNumber: string;
  contactName: string;
  vars: Record<string, string>;
  attempts: number;
  fromNumber: string;
  persona: {
    agentName?: string;
    voice?: string;
    language?: string;
    instructions?: string;
    greeting?: string;
    successCriteria?: string;
  };
  objective: string;
  goalPreset: string;
}

export async function claimCampaignJobs(limit: number): Promise<CampaignJob[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), 50);
  const rows = await db.execute(sql`
    WITH reaped AS (
      UPDATE campaign_contacts
      SET status = 'queued', claimed_at = NULL
      WHERE status = 'claimed' AND claimed_at < now() - interval '10 minutes'
      RETURNING 1
    ),
    picked AS (
      SELECT cc.id
      FROM campaign_contacts cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.status = 'queued'
        AND c.status = 'running'
        AND (cc.next_attempt_at IS NULL OR cc.next_attempt_at <= now())
        AND EXTRACT(DOW FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            IN (SELECT jsonb_array_elements_text(c.call_window->'days')::int)
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            >= (c.call_window->>'startHour')::int
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
            < (c.call_window->>'endHour')::int
        AND (
          SELECT count(*) FROM campaign_contacts x
          WHERE x.campaign_id = c.id AND x.status IN ('claimed', 'calling')
        ) < c.concurrency
      ORDER BY cc.created_at
      LIMIT ${n}
      FOR UPDATE OF cc SKIP LOCKED
    ),
    updated AS (
      UPDATE campaign_contacts cc
      SET status = 'claimed', claimed_at = now(), attempts = attempts + 1
      WHERE cc.id IN (SELECT id FROM picked)
      RETURNING cc.id, cc.campaign_id, cc.user_id, cc.phone_number,
                cc.contact_name, cc.vars, cc.attempts
    )
    SELECT u.id AS contact_id, u.campaign_id, u.user_id, u.phone_number,
           u.contact_name, u.vars, u.attempts,
           c.from_number, c.persona, c.objective, c.goal_preset
    FROM updated u
    JOIN campaigns c ON c.id = u.campaign_id
  `);

  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<
    Record<string, unknown>
  >;
  return list.map((r) => ({
    contactId: String(r.contact_id),
    campaignId: String(r.campaign_id),
    userId: String(r.user_id),
    phoneNumber: String(r.phone_number ?? ""),
    contactName: String(r.contact_name ?? ""),
    vars: (r.vars as Record<string, string>) ?? {},
    attempts: Number(r.attempts ?? 1),
    fromNumber: String(r.from_number ?? ""),
    persona: (r.persona as CampaignJob["persona"]) ?? {},
    objective: String(r.objective ?? ""),
    goalPreset: String(r.goal_preset ?? "custom"),
  }));
}
