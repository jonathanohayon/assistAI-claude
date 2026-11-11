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
}
