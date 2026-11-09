// Boucle de dispatch — SERVER-ONLY. Réclame les contacts dus puis compose
// chaque appel. Appelée par le cron (/api/cron/campaign-dispatch) et au
// démarrage d'une campagne (route status). Idempotent et borné par `limit`.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaignContacts } from "@/lib/db/schema";
import { claimCampaignJobs } from "@/lib/campaigns/claim";
import { dialContact } from "@/lib/campaigns/dial";
import {
  campaignBlockers,
  DISPATCH_TICK_KEY,
  type CallWindow,
  type DispatchTick,
} from "@/lib/campaigns/live";
import { logEvent } from "@/lib/logger";
import { setSetting } from "@/lib/settings";

export interface DispatchResult {
  claimed: number;
  dialed: number;
  failed: number;
}

async function requeue(contactId: string): Promise<void> {
  await db
    .update(campaignContacts)
    .set({ status: "queued", claimedAt: null, callState: "", callStateAt: null })
    .where(eq(campaignContacts.id, contactId));
}

export async function dispatchDueJobs(
  limit: number,
  source: DispatchTick["source"] = "cron",
): Promise<DispatchResult> {
  const jobs = await claimCampaignJobs(limit);
  let dialed = 0;
  let failed = 0;
  const perCampaign = new Map<string, DispatchResult>();
  const bump = (id: string, k: keyof DispatchResult) => {
    const r = perCampaign.get(id) ?? { claimed: 0, dialed: 0, failed: 0 };
    r[k]++;
    perCampaign.set(id, r);
  };

  for (const job of jobs) {
    bump(job.campaignId, "claimed");
    // Format parsé par le worker (detectOrigin) pour reconnaître l'appel
    // comme campagne dès l'entrée, sans dépendre de la metadata SIP/job :
    //   campaign__<campaignId>__<contactId>__<attempts>
    const roomName = `campaign__${job.campaignId}__${job.contactId}__${job.attempts}`;
    try {
      await dialContact({
        phoneNumber: job.phoneNumber,
        fromNumber: job.fromNumber || undefined,
        roomName,
        campaignId: job.campaignId,
        contactId: job.contactId,
        userId: job.userId,
      });
      // Marque "calling" — repassera en terminal via /api/agent/campaign-result.
      await db
        .update(campaignContacts)
        .set({ status: "calling", callState: "dialing", callStateAt: sql`now()` })
        .where(eq(campaignContacts.id, job.contactId));
      dialed++;
      bump(job.campaignId, "dialed");
      await logEvent({
        source: "web",
        event: "campaign_dial",
        message: `Dialling ${job.phoneNumber} (attempt ${job.attempts})`,
        userId: job.userId,
        metadata: { campaignId: job.campaignId, contactId: job.contactId, attempt: job.attempts },
      });
    } catch (e) {
      failed++;
      bump(job.campaignId, "failed");
      await requeue(job.contactId);
      await logEvent({
        source: "web",
        event: "campaign_dial_failed",
        level: "error",
        message: `Échec de composition ${job.phoneNumber} : ${
          e instanceof Error ? e.message : "unknown"
        }`,
        userId: job.userId,
        metadata: { campaignId: job.campaignId, contactId: job.contactId },
      });
    }
  }

  // Observability must never break dialling.
  try {
    await recordTick({ source, claimed: jobs.length, dialed, failed }, perCampaign);
  } catch (e) {
    console.error("[dispatch] tick logging failed", e);
  }

  return { claimed: jobs.length, dialed, failed };
}

/**
 * One `dispatch_tick` event per running campaign (with the reasons it was not
 * dialled) + the global last tick in app_settings, so the live console can
 * answer "is the dispatcher running at all?" and "why isn't it dialling?".
 */
async function recordTick(
  totals: Omit<DispatchTick, "at" | "runningCampaigns">,
  perCampaign: Map<string, DispatchResult>,
): Promise<void> {
  const now = new Date();
  const rows = await db.execute(sql`
    SELECT c.id, c.user_id, c.status, c.call_window, c.concurrency,
      (SELECT count(*) FROM campaign_contacts x
        WHERE x.campaign_id = c.id AND x.status IN ('claimed', 'calling'))::int AS in_flight,
      (SELECT count(*) FROM campaign_contacts x
        WHERE x.campaign_id = c.id AND x.status = 'queued'
          AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now()))::int AS due_queued
    FROM campaigns c
    WHERE c.status = 'running'
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<
    Record<string, unknown>
  >;

  for (const r of list) {
    const id = String(r.id);
    const mine = perCampaign.get(id) ?? { claimed: 0, dialed: 0, failed: 0 };
    const reasons = campaignBlockers(
      {
        status: String(r.status),
        callWindow: r.call_window as CallWindow,
        concurrency: Number(r.concurrency ?? 0),
        inFlight: Number(r.in_flight ?? 0),
        dueQueued: Number(r.due_queued ?? 0),
      },
      now,
    );
    await logEvent({
      source: "web",
      event: "dispatch_tick",
      message:
        mine.dialed > 0
          ? `Dispatcher (${totals.source}): dialled ${mine.dialed}, failed ${mine.failed}`
          : `Dispatcher (${totals.source}): nothing dialled${reasons.length ? ` (${reasons.join(", ")})` : ""}`,
      userId: String(r.user_id),
      metadata: {
        campaignId: id,
        source: totals.source,
        ...mine,
        skipped: reasons,
        inFlight: Number(r.in_flight ?? 0),
        dueQueued: Number(r.due_queued ?? 0),
      },
    });
  }

  const tick: DispatchTick = { at: now.toISOString(), ...totals, runningCampaigns: list.length };
  await setSetting(DISPATCH_TICK_KEY, JSON.stringify(tick));
}

// Compose UN appel hors file (bouton "Appel test immédiat") : bypasse la
// fenêtre horaire et le claim. Le contact doit déjà exister (status 'calling').
export async function dialOneNow(opts: {
  phoneNumber: string;
  fromNumber?: string;
  campaignId: string;
  contactId: string;
  userId: string;
}): Promise<{ roomName: string }> {
  // MÊME format que dispatchDueJobs (campaign__<campaignId>__<contactId>__…)
  // pour que le worker reconnaisse l'appel test comme une campagne (sinon il
  // tombe sur un autre tenant). Le 4ᵉ segment marque le test.
  const roomName = `campaign__${opts.campaignId}__${opts.contactId}__test${Date.now()}`;
  const res = await dialContact({ ...opts, roomName });
  return { roomName: res.roomName };
}
