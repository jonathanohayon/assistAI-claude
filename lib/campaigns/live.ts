// Live campaign console — pure helpers (no DB), shared by the dispatcher
// (dispatch_tick reasons), the worker progress webhook and the admin live API.

import type { DryRunCampaignCounts, DryRunCounts } from "./dispatch-mode";

export const CALL_STATES = ["dialing", "ringing", "in_call", "ended"] as const;
export type CallState = (typeof CALL_STATES)[number];

export function isCallState(v: unknown): v is CallState {
  return typeof v === "string" && (CALL_STATES as readonly string[]).includes(v);
}

export interface CallWindow {
  timezone: string;
  days: number[]; // 0-6, Sunday = 0
  startHour: number;
  endHour: number;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Same rule as the claim SQL: day in `days` and startHour <= hour < endHour, in the campaign timezone. */
export function isInCallWindow(w: CallWindow, now: Date): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: w.timezone || "Asia/Jerusalem",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return false; // invalid timezone: the SQL would fail too, never dial
  }
  const day = WEEKDAY[parts.find((p) => p.type === "weekday")?.value ?? ""];
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return w.days.includes(day) && hour >= w.startHour && hour < w.endHour;
}

export type BlockReason =
  | "campaign_not_running"
  | "outside_call_window"
  | "concurrency_full"
  | "no_due_contacts";

export interface CampaignSnapshot {
  status: string;
  callWindow: CallWindow;
  concurrency: number;
  inFlight: number; // contacts 'claimed' | 'calling'
  dueQueued: number; // 'queued' and next_attempt_at passed (or null)
}

/**
 * Why the dispatcher would NOT dial this campaign right now. Empty = it can
 * dial. Mirrors the WHERE clause of claimCampaignJobs, in the same order an
 * operator would check it.
 */
export function campaignBlockers(c: CampaignSnapshot, now: Date): BlockReason[] {
  const reasons: BlockReason[] = [];
  if (c.status !== "running") reasons.push("campaign_not_running");
  if (!isInCallWindow(c.callWindow, now)) reasons.push("outside_call_window");
  if (c.inFlight >= c.concurrency) reasons.push("concurrency_full");
  if (c.dueQueued === 0) reasons.push("no_due_contacts");
  return reasons;
}

/** app_settings key holding the last DispatchTick (JSON). */
export const DISPATCH_TICK_KEY = "campaign_dispatch_last_tick";

export interface DispatchTick {
  at: string; // ISO
  source: "cron" | "start";
  /** The switch the tick ran under (absent on ticks written before it existed). Off writes no tick. */
  mode?: "dry" | "on";
  claimed: number;
  dialed: number;
  failed: number;
  runningCampaigns: number;
  /**
   * Dry only: what it WOULD have dialled — counts only, never a number, name
   * or title. Campaign ids appear only as byCampaign keys (all tenants'):
   * serve it through tickForViewer, never as stored to a tenant.
   */
  wouldDial?: DryRunCounts;
}

/**
 * The tick as a NON-admin viewer of one campaign may see it: the stored tick
 * covers every tenant's running campaigns, so the tenant gets only its own
 * campaign's dry entry, and no global count (campaignsDue, contactsDue,
 * skippedCallHours, skippedConcurrency, runningCampaigns) that would reveal
 * other tenants' activity. Keys are copied one by one (an allowlist), so a key
 * added to the stored tick later never reaches a tenant by accident.
 */
export interface TenantDispatchTick {
  at: string;
  source: DispatchTick["source"];
  mode?: DispatchTick["mode"];
  claimed: number;
  dialed: number;
  failed: number;
  wouldDial?: { byCampaign: Record<string, DryRunCampaignCounts> };
}

/** Admin: the full stored tick. Anyone else: TenantDispatchTick for campaignId only. */
export function tickForViewer(
  tick: DispatchTick | null,
  campaignId: string,
  viewerIsAdmin: boolean,
): DispatchTick | TenantDispatchTick | null {
  if (!tick) return null;
  if (viewerIsAdmin) return tick;
  const out: TenantDispatchTick = {
    at: tick.at,
    source: tick.source,
    ...(tick.mode !== undefined ? { mode: tick.mode } : {}),
    claimed: tick.claimed,
    dialed: tick.dialed,
    failed: tick.failed,
  };
  if (tick.wouldDial) {
    const mine = tick.wouldDial.byCampaign?.[campaignId];
    out.wouldDial = {
      byCampaign: {
        [campaignId]: {
          due: Number(mine?.due ?? 0),
          heldByHours: Number(mine?.heldByHours ?? 0),
          heldByConcurrency: Number(mine?.heldByConcurrency ?? 0),
          // Its own entry's timestamp (a start-fresh entry), never another's.
          ...(typeof mine?.at === "string" ? { at: mine.at } : {}),
        },
      },
    };
  }
  return out;
}

/**
 * A dry campaign START (scoped to one campaign) folded into the stored tick.
 * The stored tick is the cron's view of EVERY campaign; a start only knows its
 * own campaign, so it must not overwrite the others' entries with nothing.
 *
 * Merge rule, when the stored tick is a parsable dry tick:
 *   - only wouldDial.byCampaign[campaignId] changes: set to `entry` (stamped
 *     with its own `at`), or deleted when the start found no raw due contact
 *     (`entry` undefined, i.e. what an absent id already means: 0/0/0);
 *   - everything else is kept as stored: the other entries, at, source,
 *     runningCampaigns and the global counts (campaignsDue, contactsDue,
 *     skippedCallHours, skippedConcurrency). The globals stay the cron's view
 *     of its own tick: recomputing them from byCampaign would mix two instants
 *     and the global `limit` (which only the cron applies across campaigns)
 *     could not be reproduced. The next cron tick replaces the whole tick.
 * Otherwise (no stored tick, an "on" or legacy tick without mode, unparsable
 * JSON): `fresh`, the start's own dry tick, as before.
 * Pure; the caller does the read-modify-write under a row lock.
 */
export function mergeDryStartTick(
  storedRaw: string | null | undefined,
  campaignId: string,
  fresh: DispatchTick,
): DispatchTick {
  const entry = fresh.wouldDial?.byCampaign?.[campaignId];
  const stamped = entry ? { ...entry, at: fresh.at } : undefined;
  const freshOut: DispatchTick = {
    ...fresh,
    wouldDial: { ...(fresh.wouldDial as DryRunCounts), byCampaign: stamped ? { [campaignId]: stamped } : {} },
  };
  let stored: DispatchTick | null = null;
  try {
    stored = storedRaw ? (JSON.parse(storedRaw) as DispatchTick) : null;
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== "object" || stored.mode !== "dry" || !stored.wouldDial || typeof stored.wouldDial !== "object")
    return freshOut;
  const byCampaign: Record<string, DryRunCampaignCounts> = { ...(stored.wouldDial.byCampaign ?? {}) };
  if (stamped) byCampaign[campaignId] = stamped;
  else delete byCampaign[campaignId];
  return { ...stored, wouldDial: { ...stored.wouldDial, byCampaign } };
}

/** Contact row sort for the console: live calls first, then queue, then done. */
export function contactRank(status: string, callState: string): number {
  if (status === "calling" && callState === "in_call") return 0;
  if (status === "calling") return 1;
  if (status === "claimed") return 2;
  if (status === "queued") return 3;
  return 4;
}

/**
 * Worker progress events can arrive out of order (retries, parallel posts):
 * a call state only moves forward. A fresh dial ('dialing') always applies,
 * since it starts a new attempt.
 */
export function shouldApplyCallState(current: string, next: CallState): boolean {
  if (next === "dialing") return true;
  const cur = (CALL_STATES as readonly string[]).indexOf(current);
  return CALL_STATES.indexOf(next) > cur;
}
