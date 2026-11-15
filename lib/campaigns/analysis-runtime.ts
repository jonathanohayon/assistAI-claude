// Server wiring for the post-call analysis (lib/campaigns/analysis.ts): the
// LLM (analyze.ts), the atomic claim + write-once DB updates, the logger,
// the after-response scheduler and the cron catch-up. SERVER-ONLY.
//
// No switch: the analysis always ran (on the results GET, before); it now
// runs after the call instead. Without a provider key nothing is claimed, so
// no attempt is burnt while the key is missing. A key the provider REJECTS
// (401/403) burns no attempt either: the claim is released and one deduped
// admin alert goes out (AUTH_FAILED_ALERT).

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { campaignCalls } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { analyzeCampaignCall } from "@/lib/campaigns/analyze";
import {
  ANALYSIS_CATCHUP_PER_TICK,
  ANALYSIS_MAX_ATTEMPTS,
  ANALYSIS_OUTSIDE_WINDOW_COUNT_CAP,
  runAnalysisCatchUp,
  runCampaignAnalysis,
  type AnalysisClaim,
  type AnalysisCounts,
  type AnalysisDeps,
  type AnalysisInput,
  type AnalysisTickLog,
  type AnalysisWindow,
  type HeldAnalysis,
} from "@/lib/campaigns/analysis";

type Rows = unknown[] | { rows: unknown[] };
const rowsOf = (r: Rows): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : r.rows) as Array<Record<string, unknown>>;
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

/** Connected, non-empty transcript, not analysed yet. `t` is a fixed SQL alias. */
function unanalysed(t: "x" | "cc") {
  const a = sql.raw(t);
  return sql`(${a}.outcome = 'connected'
      AND jsonb_typeof(${a}.transcript) = 'array' AND jsonb_array_length(${a}.transcript) > 0
      AND ${a}.disposition = '' AND ${a}.summary = '')`;
}

/**
 * Claimable: unanalysed, and never claimed or an ABANDONED claim (taken
 * before staleBeforeIso) with attempts left. claimedAt is always our own
 * toISOString() output, so a "C"-collated text comparison is a time comparison.
 */
function claimable(t: "x" | "cc", staleBeforeIso: string) {
  const a = sql.raw(t);
  return sql`(${unanalysed(t)} AND (${a}.analysis_claim IS NULL OR (
      ${a}.analysis_claim->>'pending' = 'true'
      AND (${a}.analysis_claim->>'claimedAt') COLLATE "C" < ${staleBeforeIso}::text COLLATE "C"
      AND CASE WHEN jsonb_typeof(${a}.analysis_claim->'attempt') = 'number'
               THEN (${a}.analysis_claim->>'attempt')::numeric < ${ANALYSIS_MAX_ATTEMPTS}
               ELSE true END)))`;
}

/**
 * Claims up to `limit` calls in ONE statement, oldest first, created after the
 * cut-off (optionally only `onlyId`). FOR UPDATE SKIP LOCKED: a concurrent
 * claimer skips rows this one is claiming, and the outer WHERE re-checks
 * claimable() on the row's latest version, so a row is never claimed twice.
 * Returns the context the analysis needs (campaign objective/criteria, agent
 * language) and the claim each row held before (read under the row lock),
 * restored if the provider rejects the key.
 */
async function claimRows(limit: number, w: AnalysisWindow, onlyId?: string): Promise<HeldAnalysis[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), ANALYSIS_CATCHUP_PER_TICK);
  const token = randomUUID();
  const r = (await db.execute(sql`
    UPDATE campaign_calls AS cc
       SET analysis_claim = jsonb_build_object(
             'v', 1, 'pending', true, 'claimedAt', ${w.nowIso}::text, 'token', ${token}::text,
             'attempt', CASE WHEN cc.analysis_claim IS NULL THEN 1
                             WHEN jsonb_typeof(cc.analysis_claim->'attempt') = 'number'
                               THEN (cc.analysis_claim->>'attempt')::numeric::int + 1
                             ELSE 2 END)
      FROM campaigns AS c LEFT JOIN outbound_agents AS ag ON ag.id = c.agent_id,
           (SELECT x.id, x.analysis_claim AS prev FROM campaign_calls x
             WHERE x.created_at >= ${w.cutoffIso}::timestamptz
               ${onlyId ? sql`AND x.id = ${onlyId}::uuid` : sql``}
               AND ${claimable("x", w.staleBeforeIso)}
             ORDER BY x.created_at, x.id
             LIMIT ${n}
             FOR UPDATE OF x SKIP LOCKED) AS p
     WHERE c.id = cc.campaign_id
       AND cc.id = p.id
       AND ${claimable("cc", w.staleBeforeIso)}
    RETURNING cc.id, cc.campaign_id, cc.user_id, cc.transcript, cc.analysis_claim,
              p.prev AS previous_claim, c.objective, c.success_criteria, ag.language
  `)) as Rows;
  return rowsOf(r).map((row) => ({
    claim: json(row.analysis_claim) as AnalysisClaim,
    previousClaim: row.previous_claim == null ? null : json(row.previous_claim),
    input: {
      callRowId: String(row.id),
      campaignId: String(row.campaign_id),
      userId: String(row.user_id),
      transcript: (json(row.transcript) ?? []) as AnalysisInput["transcript"],
      objective: String(row.objective ?? ""),
      successCriteria: String(row.success_criteria ?? ""),
      language: typeof row.language === "string" ? row.language : null,
    },
  }));
}

export async function claimAnalysisOne(callRowId: string, w: AnalysisWindow): Promise<HeldAnalysis | null> {
  return (await claimRows(1, w, callRowId))[0] ?? null;
}

export async function claimAnalysisBatch(limit: number, w: AnalysisWindow): Promise<HeldAnalysis[]> {
  return claimRows(limit, w);
}

/** Write-once: only that row, only while it still holds exactly our claim and is unanalysed. Clears the claim. */
export async function writeClaimedAnalysis(
  callRowId: string,
  claim: AnalysisClaim,
  a: { success: string; sentiment: string; summary: string },
): Promise<boolean> {
  const rows = await db
    .update(campaignCalls)
    .set({ disposition: a.success, sentiment: a.sentiment, summary: a.summary, analysisClaim: null })
    .where(
      and(
        eq(campaignCalls.id, callRowId),
        sql`${campaignCalls.analysisClaim} = ${JSON.stringify(claim)}::jsonb`,
        sql`${campaignCalls.disposition} = ''`,
        sql`${campaignCalls.summary} = ''`,
      ),
    )
    .returning({ id: campaignCalls.id });
  return rows.length > 0;
}

/**
 * Auth failure: puts the claim back to what the row held before it (NULL or
 * the abandoned claim), so the attempt is not consumed. Only that row, only
 * while it still holds exactly our claim and is unanalysed.
 */
export async function releaseAnalysisClaim(callRowId: string, claim: AnalysisClaim, previous: unknown): Promise<boolean> {
  const prev = previous == null ? sql`NULL` : sql`${JSON.stringify(previous)}::jsonb`;
  const rows = await db
    .update(campaignCalls)
    .set({ analysisClaim: sql`${prev}` })
    .where(
      and(
        eq(campaignCalls.id, callRowId),
        sql`${campaignCalls.analysisClaim} = ${JSON.stringify(claim)}::jsonb`,
        sql`${campaignCalls.disposition} = ''`,
        sql`${campaignCalls.summary} = ''`,
      ),
    )
    .returning({ id: campaignCalls.id });
  return rows.length > 0;
}

/**
 * The one admin alert for a rejected key, deduped by the atomic ledger.
 * Names env vars only (as lib/health-checks.ts does), never a value, a
 * transcript or account data. Critical: analysis is stopped until the key is
 * rotated, and a warning raised at night would be dropped (quiet hours).
 */
export const AUTH_FAILED_ALERT = {
  key: "campaign_analysis_auth_failed",
  subject: "Campaign analysis paused: model API key rejected",
  body:
    "The model provider rejected the API key; campaign analysis is paused.\n\n" +
    "Calls are not lost: no analysis attempt is consumed, and the cron catch-up resumes once the key " +
    "(REALTIME_API_KEY, else OPENAI_API_KEY, on the web service) is rotated.",
  dedupMs: 6 * 60 * 60 * 1000,
  severity: "critical" as const,
};

/** Unanalysed connected calls older than the cut-off: counted with a LIMIT (never a full scan count). */
export async function countAnalysisOutsideWindow(w: AnalysisWindow): Promise<number> {
  const r = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM campaign_calls x
       WHERE x.created_at < ${w.cutoffIso}::timestamptz AND ${unanalysed("x")}
       LIMIT ${ANALYSIS_OUTSIDE_WINDOW_COUNT_CAP}) s
  `)) as Rows;
  return Number(rowsOf(r)[0]?.n ?? 0);
}

/** The per-tick event: counts only, no user, no ids. */
export async function logAnalysisTick(m: AnalysisTickLog): Promise<void> {
  await logEvent({
    source: "web",
    event: "campaign_analysis_catchup",
    level: "info",
    message: `Analysis catch-up: ${m.picked} picked, ${m.outsideWindow} outside the window${m.authFailed ? ", paused (provider rejected the key)" : ""}`,
    metadata: { picked: m.picked, outsideWindow: m.outsideWindow, ...(m.authFailed ? { authFailed: true } : {}) },
  });
}

export interface AnalysisRuntime extends Omit<AnalysisDeps, "log" | "now"> {
  /** False = no provider key: nothing is claimed, scheduled or analysed. */
  enabled: () => boolean;
  /** Runs the task after the response is sent (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
}

const defaultRuntime: AnalysisRuntime = {
  enabled: () => !!(process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY),
  llm: analyzeCampaignCall,
  claimOne: claimAnalysisOne,
  claimBatch: claimAnalysisBatch,
  writeClaimed: writeClaimedAnalysis,
  releaseClaim: releaseAnalysisClaim,
  alertAuthFailed: () => alertAdmins(AUTH_FAILED_ALERT),
  countOutsideWindow: countAnalysisOutsideWindow,
  logTick: logAnalysisTick,
  schedule: (task) => after(task),
};
let runtime: AnalysisRuntime = defaultRuntime;

/** Tests only: swap the LLM / DB steps / scheduler. Returns a restore function. */
export function setAnalysisRuntimeForTests(r: Partial<AnalysisRuntime>): () => void {
  runtime = { ...defaultRuntime, ...r };
  return () => {
    runtime = defaultRuntime;
  };
}

function depsOf(r: AnalysisRuntime): AnalysisDeps {
  return {
    llm: r.llm,
    claimOne: r.claimOne,
    claimBatch: r.claimBatch,
    writeClaimed: r.writeClaimed,
    releaseClaim: r.releaseClaim,
    alertAuthFailed: r.alertAuthFailed,
    countOutsideWindow: r.countOutsideWindow,
    logTick: r.logTick,
    log: (ev) => logEvent({ source: "web", ...ev }),
  };
}

const NO_COUNTS: AnalysisCounts = { claimed: 0, written: 0, failed: 0, skipped: 0 };

/** Cron tick: one bounded catch-up pass. Never throws; never dials. Counts only. */
export async function runCampaignAnalysisCatchUp(): Promise<AnalysisCounts> {
  const r = runtime;
  try {
    if (!r.enabled()) return { ...NO_COUNTS };
    return await runAnalysisCatchUp(depsOf(r));
  } catch {
    return { ...NO_COUNTS };
  }
}

/**
 * Schedules the analysis of one just-inserted call after the response. Never
 * throws into the route: a scheduling failure is swallowed (the cron catch-up
 * picks the call up), the task itself never throws.
 */
export function scheduleCampaignAnalysis(callRowId: string): void {
  const r = runtime;
  try {
    if (!r.enabled()) return;
    r.schedule(() => runCampaignAnalysis(callRowId, depsOf(r)));
  } catch {
    // after() outside a request scope, or similar: the catch-up covers it.
  }
}
