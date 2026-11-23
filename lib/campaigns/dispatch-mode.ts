// Server-side switch for campaign auto-dispatch (env CAMPAIGN_DISPATCH):
//   unset / anything else = "off": claims nothing, dials nothing.
//   "dry": computes what it WOULD dial — counts only, nothing written.
//   "on":  today's behaviour.
// Gates dispatchDueJobs itself, so the cron AND a campaign start/resume obey
// it. The owner's single test call and call-me (CALL_ME) are not dispatch.
export type DispatchMode = "off" | "dry" | "on";

export function dispatchMode(env: Record<string, string | undefined> = process.env): DispatchMode {
  const v = (env.CAMPAIGN_DISPATCH ?? "").trim().toLowerCase();
  return v === "on" || v === "dry" ? v : "off";
}

/** What dry mode reports: COUNTS only — no number, name or campaign title. */
export interface DryRunCounts {
  /** Running campaigns with at least one contact it would dial now. */
  campaignsDue: number;
  /** Contacts it would claim and dial now (by the claim's own rule, `limit` applied). */
  contactsDue: number;
  /** Queued, due contacts of running campaigns held back by call hours. */
  skippedCallHours: number;
  /** Due contacts of campaigns already at their concurrency. */
  skippedConcurrency: number;
  /**
   * Per running campaign with at least one raw due contact: the same rule,
   * that campaign only. An absent id means 0 / 0 / 0. The tick is GLOBAL
   * (every tenant): never serve this map as stored to a tenant, only its own
   * entry (lib/campaigns/live.ts tickForViewer).
   */
  byCampaign?: Record<string, DryRunCampaignCounts>;
}

export interface DryRunCampaignCounts {
  /** What it would dial now: in hours, its free slots, the global limit. */
  due: number;
  /** Its due contacts held back because it is outside its call hours (0 in hours). */
  heldByHours: number;
  /** Its due contacts beyond its free slots (in hours only). */
  heldByConcurrency: number;
}
