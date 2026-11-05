// Live campaign console — pure helpers (no DB), shared by the dispatcher
// (dispatch_tick reasons), the worker progress webhook and the admin live API.

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
  claimed: number;
  dialed: number;
  failed: number;
  runningCampaigns: number;
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
