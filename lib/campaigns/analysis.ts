// Post-call analysis of a connected campaign call (success verdict,
// sentiment, one-line summary: lib/campaigns/analyze.ts), run AFTER THE CALL:
// scheduled by POST /api/agent/campaign-result with next/server after(), and
// caught up on the campaign-dispatch cron tick for calls after() missed.
// Never as a side effect of a GET (the results route only reads).
// PURE (no DB, no network): the LLM, the claim, the write and the logger are
// injected. The server wiring is lib/campaigns/analysis-runtime.ts.
//
// Write-once through campaign_calls.analysis_claim: the LLM is called only
// once a claim is held, and the result is written only while the row still
// holds that exact claim and is still unanalysed (disposition = '' AND
// summary = ''), so after() and any number of overlapping ticks analyse a
// call at most once.
//
// A REJECTED KEY (provider 401/403, analyze.ts → "auth_failed") is not an
// attempt: the claim is put back to its previous state (attempt count
// unchanged), one deduped admin alert is raised, and the catch-up pauses for
// that tick (it claims one call first and stops there). Every other failure
// still consumes an attempt.

import { ANALYSIS_AUTH_FAILED, type AnalysisAuthFailed, type CallAnalysis } from "@/lib/campaigns/analyze";

// Bounds (one constant each):
/** At most this many calls claimed per cron tick, oldest first. */
export const ANALYSIS_CATCHUP_PER_TICK = 10;
/**
 * CUT-OFF: only calls created within the last N hours are picked by the
 * catch-up (same 72 h as capture). Calls older than that when this ships,
 * still unanalysed, are NEVER analysed (they are counted in the per-tick log).
 * Raising this constant once analyses them via the catch-up, 10 per tick.
 */
export const ANALYSIS_CATCHUP_CUTOFF_HOURS = 72;
/** The per-tick log's `outsideWindow` count is bounded by this (a LIMIT in the query). */
export const ANALYSIS_OUTSIDE_WINDOW_COUNT_CAP = 1000;
/** A pending claim older than this is abandoned (process killed, LLM failure) and can be re-claimed. */
export const ANALYSIS_CLAIM_STALE_MINUTES = 10;
/** At most this many analysis attempts (LLM calls) per call, after() included. */
export const ANALYSIS_MAX_ATTEMPTS = 3;

export type Turn = { role: "user" | "assistant"; text: string };

/** Stored in campaign_calls.analysis_claim while an analysis runs (and after a failed attempt). */
export interface AnalysisClaim {
  v: 1;
  pending: true;
  claimedAt: string;
  /** Random per claim statement, so two claims of one row never compare equal. */
  token: string;
  /** 1 for the first claim, +1 per re-claim; ANALYSIS_MAX_ATTEMPTS = never re-claimed. */
  attempt: number;
}

/** What the analysis needs, read from the row, its campaign and its agent at claim time. */
export interface AnalysisInput {
  callRowId: string;
  campaignId: string;
  userId: string;
  transcript: Turn[];
  objective: string;
  successCriteria: string;
  /** The campaign agent's language; null = no agent ("fr", as before). */
  language: string | null;
}

/** One call claimed, with the claim it holds. */
export interface HeldAnalysis {
  input: AnalysisInput;
  claim: AnalysisClaim;
  /** The row's analysis_claim before this claim (null = never claimed); restored on an auth failure. */
  previousClaim?: unknown;
}

export type AnalysisLlm = (opts: {
  transcript: Turn[];
  objective: string;
  successCriteria: string;
  language?: string | null;
}) => Promise<CallAnalysis | AnalysisAuthFailed | null>;

/** The catch-up's time bounds at `now`, as ISO strings. */
export interface AnalysisWindow {
  nowIso: string;
  /** Calls created before this are never picked. */
  cutoffIso: string;
  /** Pending claims taken before this are abandoned. */
  staleBeforeIso: string;
}

export function analysisWindow(now: Date): AnalysisWindow {
  const t = now.getTime();
  return {
    nowIso: now.toISOString(),
    cutoffIso: new Date(t - ANALYSIS_CATCHUP_CUTOFF_HOURS * 3_600_000).toISOString(),
    staleBeforeIso: new Date(t - ANALYSIS_CLAIM_STALE_MINUTES * 60_000).toISOString(),
  };
}

export interface AnalysisDeps {
  llm: AnalysisLlm;
  /** Atomically claims that one row if it is claimable (see claimBatch); null otherwise. */
  claimOne: (callRowId: string, window: AnalysisWindow) => Promise<HeldAnalysis | null>;
  /**
   * Atomically claims up to `limit` claimable calls created after
   * window.cutoffIso, oldest first: connected, non-empty transcript,
   * disposition = '' AND summary = '', and analysis_claim NULL or an abandoned
   * claim with attempts left. Rows claimed by someone else are skipped.
   */
  claimBatch: (limit: number, window: AnalysisWindow) => Promise<HeldAnalysis[]>;
  /** Writes the analysis ONLY if the row still holds exactly `claim` and is unanalysed; true when written. */
  writeClaimed: (callRowId: string, claim: AnalysisClaim, analysis: CallAnalysis) => Promise<boolean>;
  /**
   * Puts the row's claim back to `previous` ONLY if it still holds exactly
   * `claim` and is unanalysed (the attempt is not consumed); true when released.
   */
  releaseClaim: (callRowId: string, claim: AnalysisClaim, previous: unknown) => Promise<boolean>;
  /** The deduped admin alert for a rejected key. Must never throw (alertAdmins does not). */
  alertAuthFailed: () => Promise<unknown>;
  /** Unanalysed connected calls older than the cut-off, counted up to ANALYSIS_OUTSIDE_WINDOW_COUNT_CAP. */
  countOutsideWindow: (window: AnalysisWindow) => Promise<number>;
  /** The per-tick log: COUNTS ONLY. */
  logTick: (m: AnalysisTickLog) => Promise<void>;
  /** Metadata carries ids and counts only: never transcript text or analysis values. */
  log: (ev: { event: string; level: "info" | "warn"; message: string; userId: string; metadata: Record<string, unknown> }) => Promise<void>;
  now?: () => Date;
}

export interface AnalysisTickLog {
  picked: number;
  outsideWindow: number;
  /** Present (true) only when the tick paused on a rejected key. */
  authFailed?: true;
}

export interface AnalysisCounts {
  claimed: number;
  written: number;
  /** Attempts consumed without a result. Auth failures are not counted here (they are `skipped`). */
  failed: number;
  skipped: number;
  /** Present (true) only when the tick paused on a rejected key. */
  authFailed?: true;
}

export type AnalysisResult = "written" | "already_done" | "failed" | "auth_failed";

/** Cheap pre-check before scheduling, same rule as the claim: a connected call with a non-empty transcript. */
export function shouldAnalyze(outcome: string, transcript: unknown): boolean {
  return outcome === "connected" && Array.isArray(transcript) && transcript.length > 0;
}

function isAnalysisClaim(x: unknown): x is AnalysisClaim {
  return !!x && typeof x === "object" && (x as { pending?: unknown }).pending === true;
}

/**
 * Results GET: a call still waiting for its analysis, i.e. one the after()
 * path or the catch-up can still analyse: connected, non-empty transcript,
 * not analysed yet, created within the cut-off, attempts left.
 */
export function isAnalysisPending(
  c: { outcome: string; transcript: unknown; disposition: string; summary: string; createdAt: Date; analysisClaim?: unknown },
  now: Date,
): boolean {
  if (!shouldAnalyze(c.outcome, c.transcript) || c.disposition || c.summary) return false;
  if (c.createdAt.getTime() < now.getTime() - ANALYSIS_CATCHUP_CUTOFF_HOURS * 3_600_000) return false;
  const claim = c.analysisClaim;
  if (isAnalysisClaim(claim) && typeof claim.attempt === "number" && claim.attempt >= ANALYSIS_MAX_ATTEMPTS) {
    // The last attempt may still be running (fresh claim); once abandoned, it never runs again.
    return typeof claim.claimedAt === "string" && claim.claimedAt >= analysisWindow(now).staleBeforeIso;
  }
  return true;
}

/**
 * A rejected key: release the claim (no attempt consumed), log ids only, raise
 * the deduped alert. Never throws. If the release itself fails, the claim
 * stays and is re-claimed once abandoned, like any failed attempt.
 */
async function onAuthFailed(held: HeldAnalysis, deps: AnalysisDeps): Promise<AnalysisResult> {
  const { input, claim } = held;
  let released = false;
  try {
    released = await deps.releaseClaim(input.callRowId, claim, held.previousClaim ?? null);
  } catch (e) {
    console.error("[analysis] claim release failed:", e instanceof Error ? e.name : "error");
  }
  try {
    await deps.log({
      event: "campaign_analysis_auth_failed",
      level: "warn",
      message: "Model provider rejected the API key: campaign analysis paused",
      userId: input.userId,
      metadata: { campaignId: input.campaignId, campaignCallId: input.callRowId, attempt: claim.attempt, released },
    });
  } catch {
    // logging must never throw into the caller
  }
  try {
    await deps.alertAuthFailed();
  } catch {
    // alerting must never throw into the caller
  }
  return "auth_failed";
}

/**
 * Analyses a call whose claim is already held. Never throws. On failure the
 * claim stays: re-claimed by the catch-up once abandoned, up to
 * ANALYSIS_MAX_ATTEMPTS attempts in all. On a rejected key (auth_failed) the
 * claim is released instead: no attempt consumed.
 */
export async function runHeldAnalysis(held: HeldAnalysis, deps: AnalysisDeps): Promise<AnalysisResult> {
  const { input, claim } = held;
  const meta = { campaignId: input.campaignId, campaignCallId: input.callRowId, attempt: claim.attempt };
  const fail = async (reason: string): Promise<AnalysisResult> => {
    try {
      await deps.log({
        event: "campaign_analysis_failed",
        level: "warn",
        message: "Analyse de l'appel de campagne impossible",
        userId: input.userId,
        metadata: { ...meta, reason },
      });
    } catch {
      // logging must never throw into the caller
    }
    return "failed";
  };
  try {
    const a = await deps.llm({
      transcript: input.transcript,
      objective: input.objective,
      successCriteria: input.successCriteria,
      language: input.language ?? "fr",
    });
    if (a === ANALYSIS_AUTH_FAILED) return await onAuthFailed(held, deps);
    if (!a) return await fail("llm_unavailable");
    const written = await deps.writeClaimed(input.callRowId, claim, a);
    return written ? "written" : "already_done";
  } catch (e) {
    return await fail(e instanceof Error ? `error:${e.name}` : "error");
  }
}

/** after() path: claims that one row, then analyses it. Never throws. */
export async function runCampaignAnalysis(callRowId: string, deps: AnalysisDeps): Promise<AnalysisResult> {
  let held: HeldAnalysis | null;
  try {
    held = await deps.claimOne(callRowId, analysisWindow((deps.now ?? (() => new Date()))()));
  } catch (e) {
    console.error("[analysis] claim failed:", e instanceof Error ? e.name : "error");
    return "failed";
  }
  if (!held) return "already_done";
  return runHeldAnalysis(held, deps);
}

/**
 * One bounded catch-up pass (cron tick). Never throws; never dials.
 * Claims ONE call first and analyses it alone: on a rejected key the tick
 * pauses there (nothing else is claimed). Otherwise it claims the rest of the
 * per-tick budget and analyses them together; any of them hitting a rejected
 * key is released too (no attempt consumed).
 */
export async function runAnalysisCatchUp(deps: AnalysisDeps): Promise<AnalysisCounts> {
  const counts: AnalysisCounts = { claimed: 0, written: 0, failed: 0, skipped: 0 };
  const window = analysisWindow((deps.now ?? (() => new Date()))());
  const tally = (r: AnalysisResult) => {
    if (r === "written") counts.written++;
    else if (r === "failed") counts.failed++;
    else {
      counts.skipped++;
      if (r === "auth_failed") counts.authFailed = true;
    }
  };
  let first: HeldAnalysis[];
  try {
    first = await deps.claimBatch(1, window);
  } catch (e) {
    console.error("[analysis] catch-up claim failed:", e instanceof Error ? e.name : "error");
    return counts;
  }
  counts.claimed = first.length;
  if (first.length > 0) tally(await runHeldAnalysis(first[0]!, deps));
  let rest: HeldAnalysis[] = [];
  if (first.length > 0 && !counts.authFailed && ANALYSIS_CATCHUP_PER_TICK > 1) {
    try {
      rest = await deps.claimBatch(ANALYSIS_CATCHUP_PER_TICK - 1, window);
    } catch (e) {
      console.error("[analysis] catch-up claim failed:", e instanceof Error ? e.name : "error");
    }
  }
  counts.claimed += rest.length;
  try {
    const outsideWindow = Math.min(
      Math.max(Math.trunc(await deps.countOutsideWindow(window)) || 0, 0),
      ANALYSIS_OUTSIDE_WINDOW_COUNT_CAP,
    );
    if (counts.claimed > 0 || outsideWindow > 0) {
      await deps.logTick({ picked: counts.claimed, outsideWindow, ...(counts.authFailed ? { authFailed: true as const } : {}) });
    }
  } catch {
    // observability must never block the analysis
  }
  for (const r of await Promise.all(rest.map((h) => runHeldAnalysis(h, deps)))) tally(r);
  return counts;
}
