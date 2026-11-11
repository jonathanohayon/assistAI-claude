// Boucle de dispatch — SERVER-ONLY. Réclame les contacts dus puis compose
// chaque appel. Appelée par le cron (/api/cron/campaign-dispatch) et au
// démarrage d'une campagne (route status). Idempotent et borné par `limit`.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaignContacts } from "@/lib/db/schema";
import { claimCampaignJobs } from "@/lib/campaigns/claim";
import { dialContact } from "@/lib/campaigns/dial";
import { dispatchMode, type DryRunCounts } from "@/lib/campaigns/dispatch-mode";
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

/** Off / dry results (on returns exactly the DispatchResult as before). */
export type GatedDispatchResult =
  | (DispatchResult & { mode: "off"; reason: string })
  | (DispatchResult & { mode: "dry"; reason: string; wouldDial: DryRunCounts });

export interface DispatchDeps {
  claim: typeof claimCampaignJobs;
  dial: typeof dialContact;
  env: Record<string, string | undefined>;
}
const DEFAULT_DEPS: DispatchDeps = { claim: claimCampaignJobs, dial: dialContact, env: process.env };

async function requeue(contactId: string): Promise<void> {
  await db
    .update(campaignContacts)
    .set({ status: "queued", claimedAt: null, callState: "", callStateAt: null })
    .where(eq(campaignContacts.id, contactId));
}

export async function dispatchDueJobs(
  limit: number,
  source: DispatchTick["source"] = "cron",
  deps: Partial<DispatchDeps> = {},
  /** A campaign start: only that campaign. Omitted (cron) = every running campaign. */
  scope: { campaignId?: string } = {},
): Promise<DispatchResult | GatedDispatchResult> {
  const d = { ...DEFAULT_DEPS, ...deps };
  // CAMPAIGN_DISPATCH (lib/campaigns/dispatch-mode.ts): off and dry write
  // NOTHING — no claim, no reap, no status, no event, no tick — and dial no one.
  const mode = dispatchMode(d.env);
  if (mode === "off") {
    return { claimed: 0, dialed: 0, failed: 0, mode, reason: "CAMPAIGN_DISPATCH is off" };
  }
  if (mode === "dry") {
    const wouldDial = await dryRunCounts(limit, scope.campaignId);
    console.log(`[dispatch] dry run (${source}): ${JSON.stringify(wouldDial)}`);
    return { claimed: 0, dialed: 0, failed: 0, mode, reason: "CAMPAIGN_DISPATCH is dry: nothing claimed or dialled", wouldDial };
  }
  const jobs = await d.claim(limit, scope);
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
      await d.dial({
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
 * Dry run: what claimCampaignJobs WOULD pick now — the same conditions
 * (running campaign, queued, backoff due, call hours in the campaign's
 * timezone, per-campaign concurrency, `limit`), READ-ONLY (no FOR UPDATE, no
 * reap). Counts only.
 */
async function dryRunCounts(limit: number, campaignId?: string): Promise<DryRunCounts> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), 50);
  const rows = await db.execute(sql`
    SELECT c.id,
      GREATEST(c.concurrency - (SELECT count(*) FROM campaign_contacts x
        WHERE x.campaign_id = c.id AND x.status IN ('claimed', 'calling')), 0)::int AS free_slots,
      (EXTRACT(DOW FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int
          IN (SELECT jsonb_array_elements_text(c.call_window->'days')::int)
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int >= (c.call_window->>'startHour')::int
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE (c.call_window->>'timezone')))::int < (c.call_window->>'endHour')::int
      ) AS in_hours,
      (SELECT count(*) FROM campaign_contacts cc
        WHERE cc.campaign_id = c.id AND cc.status = 'queued'
          AND (cc.next_attempt_at IS NULL OR cc.next_attempt_at <= now()))::int AS due
    FROM campaigns c
    WHERE c.status = 'running' ${campaignId ? sql`AND c.id = ${campaignId}::uuid` : sql``}
    ORDER BY c.created_at
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  return dryRunTotals(
    list.map((r) => ({ due: Number(r.due ?? 0), freeSlots: Number(r.free_slots ?? 0), inHours: r.in_hours === true })),
    n,
  );
}

/**
 * Pure: per running campaign → the totals, by claimCampaignJobs' OWN rule
 * (so dry = what on would dial): in call hours, at most the campaign's free
 * slots (concurrency − in flight), then the global `limit`.
 */
export function dryRunTotals(campaigns: Array<{ due: number; freeSlots: number; inHours: boolean }>, limit: number): DryRunCounts {
  let left = limit;
  const out: DryRunCounts = { campaignsDue: 0, contactsDue: 0, skippedCallHours: 0, skippedConcurrency: 0 };
  for (const c of campaigns) {
    if (!c.due) continue;
    if (!c.inHours) {
      out.skippedCallHours += c.due;
      continue;
    }
    out.skippedConcurrency += Math.max(0, c.due - c.freeSlots);
    const take = Math.min(c.due, Math.max(0, c.freeSlots), left);
    if (take > 0) {
      out.campaignsDue++;
      out.contactsDue += take;
      left -= take;
    }
  }
  return out;
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
