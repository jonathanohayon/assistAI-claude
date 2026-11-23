// Boucle de dispatch — SERVER-ONLY. Réclame les contacts dus puis compose
// chaque appel. Appelée par le cron (/api/cron/campaign-dispatch) et au
// démarrage d'une campagne (route status). Idempotent et borné par `limit`.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings, campaignContacts } from "@/lib/db/schema";
import { claimCampaignJobs } from "@/lib/campaigns/claim";
import { dialContact } from "@/lib/campaigns/dial";
import { dispatchMode, type DryRunCounts } from "@/lib/campaigns/dispatch-mode";
import type { SalesTrialRefusal } from "@/lib/campaigns/sales-trial-cap";
import { salesTrialGate } from "@/lib/campaigns/sales-trial-gate";
import {
  campaignBlockers,
  DISPATCH_TICK_KEY,
  mergeDryStartTick,
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
  /** P3: the sales trial cap (null = dial as before). */
  salesTrialGate: (userId: string) => Promise<SalesTrialRefusal | null>;
}
const DEFAULT_DEPS: DispatchDeps = {
  claim: claimCampaignJobs,
  dial: dialContact,
  env: process.env,
  salesTrialGate: (userId) => salesTrialGate(userId),
};

async function requeue(contactId: string): Promise<void> {
  await db
    .update(campaignContacts)
    .set({ status: "queued", claimedAt: null, callState: "", callStateAt: null })
    .where(eq(campaignContacts.id, contactId));
}

/**
 * A dial refused by the sales trial cap: the claim is undone (queued again,
 * the attempt the claim counted given back), so the contact simply waits.
 */
async function unclaim(contactId: string): Promise<void> {
  await db
    .update(campaignContacts)
    .set({ status: "queued", claimedAt: null, attempts: sql`greatest(${campaignContacts.attempts} - 1, 0)` })
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
  // CAMPAIGN_DISPATCH (lib/campaigns/dispatch-mode.ts): off and dry claim,
  // reap, change and dial NOTHING. Off writes nothing at all; dry writes only
  // the global last tick (mode "dry" + counts), so the console sees it ran.
  const mode = dispatchMode(d.env);
  if (mode === "off") {
    return { claimed: 0, dialed: 0, failed: 0, mode, reason: "CAMPAIGN_DISPATCH is off" };
  }
  if (mode === "dry") {
    const counted = await dryRunCounts(limit, scope.campaignId);
    // byCampaign (every tenant's campaign ids) goes to the stored tick only;
    // the returned result and the log keep the global counts, as before.
    const { byCampaign, ...wouldDial } = counted;
    console.log(`[dispatch] dry run (${source}): ${JSON.stringify(wouldDial)}`);
    // Observability must never break the dry run.
    try {
      await recordDryTick(source, { ...wouldDial, byCampaign }, scope.campaignId);
    } catch (e) {
      console.error("[dispatch] dry tick logging failed", e);
    }
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

  // P3 sales trial cap, once per account per tick. An account with no
  // sales trial row (paid, grandfathered) is never refused: unchanged.
  const trialRefusals = new Map<string, SalesTrialRefusal | null>();
  const trialLogged = new Set<string>();

  for (const job of jobs) {
    bump(job.campaignId, "claimed");
    if (!trialRefusals.has(job.userId)) trialRefusals.set(job.userId, await d.salesTrialGate(job.userId));
    const refusal = trialRefusals.get(job.userId) ?? null;
    if (refusal) {
      await unclaim(job.contactId);
      // One event per account per tick; no PII (ids and the reason only).
      if (!trialLogged.has(job.userId)) {
        trialLogged.add(job.userId);
        await logEvent({
          source: "web",
          event: "campaign_dial_skipped",
          message: `Not dialled: ${refusal}`,
          userId: job.userId,
          metadata: { campaignId: job.campaignId, contactId: job.contactId, reason: refusal },
        });
      }
      continue;
    }
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
        message: `Dialling contact ${job.contactId} (attempt ${job.attempts})`,
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
        message: `Échec de composition (contact ${job.contactId}) : ${
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
    list.map((r) => ({ id: String(r.id), due: Number(r.due ?? 0), freeSlots: Number(r.free_slots ?? 0), inHours: r.in_hours === true })),
    n,
  );
}

/**
 * Pure: per running campaign → the totals, by claimCampaignJobs' OWN rule
 * (so dry = what on would dial): in call hours, at most the campaign's free
 * slots (concurrency − in flight), then the global `limit`.
 */
export function dryRunTotals(
  campaigns: Array<{ id: string; due: number; freeSlots: number; inHours: boolean }>,
  limit: number,
): DryRunCounts {
  let left = limit;
  const out: DryRunCounts = { campaignsDue: 0, contactsDue: 0, skippedCallHours: 0, skippedConcurrency: 0, byCampaign: {} };
  const by = out.byCampaign!;
  for (const c of campaigns) {
    if (!c.due) continue;
    if (!c.inHours) {
      out.skippedCallHours += c.due;
      by[c.id] = { due: 0, heldByHours: c.due, heldByConcurrency: 0 };
      continue;
    }
    const heldByConcurrency = Math.max(0, c.due - c.freeSlots);
    out.skippedConcurrency += heldByConcurrency;
    const take = Math.min(c.due, Math.max(0, c.freeSlots), left);
    if (take > 0) {
      out.campaignsDue++;
      out.contactsDue += take;
      left -= take;
    }
    by[c.id] = { due: Math.max(0, take), heldByHours: 0, heldByConcurrency };
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

  const tick: DispatchTick = { at: now.toISOString(), ...totals, mode: "on", runningCampaigns: list.length };
  await setSetting(DISPATCH_TICK_KEY, JSON.stringify(tick));
}

/**
 * Dry run's tick: the same global key, mode "dry", nothing claimed or dialled,
 * and the would-dial COUNTS (no number, name or campaign title; campaign ids
 * only as byCampaign keys). No per-campaign event: dry writes nothing but this
 * one setting. The row covers EVERY tenant: readers scope it (tickForViewer).
 * A start scoped to one campaign MERGES its entry into the stored tick
 * (mergeDryStartTick) instead of overwriting the other campaigns' entries.
 */
async function recordDryTick(
  source: DispatchTick["source"],
  wouldDial: DryRunCounts,
  campaignId?: string,
): Promise<void> {
  const rows = await db.execute(sql`SELECT count(*)::int AS n FROM campaigns WHERE status = 'running'`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  const tick: DispatchTick = {
    at: new Date().toISOString(),
    source,
    mode: "dry",
    claimed: 0,
    dialed: 0,
    failed: 0,
    runningCampaigns: Number(list[0]?.n ?? 0),
    wouldDial: {
      campaignsDue: wouldDial.campaignsDue,
      contactsDue: wouldDial.contactsDue,
      skippedCallHours: wouldDial.skippedCallHours,
      skippedConcurrency: wouldDial.skippedConcurrency,
      byCampaign: wouldDial.byCampaign ?? {},
    },
  };
  if (source === "start" && campaignId) await mergeStartTick(campaignId, tick);
  else await setSetting(DISPATCH_TICK_KEY, JSON.stringify(tick));
}

/**
 * The start's read-modify-write, atomic against a concurrent cron tick: ONE
 * transaction that locks the tick row (SELECT ... FOR UPDATE), merges and
 * writes. A cron tick's upsert (setSetting, ON CONFLICT DO UPDATE) takes the
 * same row lock, so the two serialize:
 *   - cron first: the start's FOR UPDATE waits, then reads the cron's tick
 *     (READ COMMITTED re-reads the latest row) and merges only its entry;
 *   - start first: the cron waits, then replaces the whole tick (fresher).
 * No row yet: INSERT ... ON CONFLICT DO NOTHING; if a cron inserted it in
 * between, nothing is inserted and the loop locks and merges into that row.
 */
async function mergeStartTick(campaignId: string, fresh: DispatchTick): Promise<void> {
  await db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [row] = await tx
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, DISPATCH_TICK_KEY))
        .for("update");
      const merged = JSON.stringify(mergeDryStartTick(row?.value ?? null, campaignId, fresh));
      if (row) {
        await tx.update(appSettings).set({ value: merged, updatedAt: new Date() }).where(eq(appSettings.key, DISPATCH_TICK_KEY));
        return;
      }
      const inserted = await tx
        .insert(appSettings)
        .values({ key: DISPATCH_TICK_KEY, value: merged, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ key: appSettings.key });
      if (inserted.length) return;
      // A concurrent writer created the row: lock it and merge (next pass).
    }
    throw new Error("dry start tick: the tick row vanished during the merge");
  });
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
