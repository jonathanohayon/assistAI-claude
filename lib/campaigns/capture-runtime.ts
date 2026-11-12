// Server wiring for campaign field capture (lib/campaigns/capture.ts):
// OpenAI caller, the atomic claim + write-once DB updates, logger, the
// after-response scheduler and the cron catch-up. SERVER-ONLY. Only called
// when captureMode() is "on".

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import {
  CAPTURE_CATCHUP_PER_TICK,
  CAPTURE_MAX_ATTEMPTS,
  CAPTURE_OUTSIDE_WINDOW_COUNT_CAP,
  runCampaignCapture,
  runCaptureCatchUp,
  type CatchUpCounts,
  type CatchUpDeps,
  type CatchUpTickLog,
  type CatchUpWindow,
  type CaptureClaim,
  type CaptureDeps,
  type CaptureInput,
  type CaptureLlm,
  type HeldCapture,
} from "@/lib/campaigns/capture";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const LLM_TIMEOUT_MS = 30_000;

/** OpenAI JSON-mode call, same model env and key resolution as analyze.ts; null on any error. */
export const openAiCaptureLlm: CaptureLlm = async ({ system, user }) => {
  const model =
    process.env.CAMPAIGN_CAPTURE_MODEL ??
    process.env.CAMPAIGN_ANALYZE_MODEL ??
    process.env.SUMMARY_MODEL ??
    "gpt-5.4-mini";
  const apiKey = process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return null;
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? { content, model: data.model || model } : null;
  } catch {
    return null;
  }
};

type Rows = unknown[] | { rows: unknown[] };
const rowsOf = (r: Rows): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : r.rows) as Array<Record<string, unknown>>;
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * A row is claimable when its extracted is {} or an ABANDONED claim (taken
 * before staleBeforeIso) with attempts left. `t` is a fixed SQL alias.
 * claimedAt is always our own toISOString() output, so a "C"-collated text
 * comparison is a time comparison (and never throws, unlike a cast).
 */
function claimable(t: "x" | "cc", staleBeforeIso: string) {
  const a = sql.raw(t);
  return sql`(${a}.extracted = '{}'::jsonb OR (
      ${a}.extracted->>'pending' = 'true'
      AND (${a}.extracted->>'claimedAt') COLLATE "C" < ${staleBeforeIso}::text COLLATE "C"
      AND CASE WHEN jsonb_typeof(${a}.extracted->'attempt') = 'number'
               THEN (${a}.extracted->>'attempt')::numeric < ${CAPTURE_MAX_ATTEMPTS}
               ELSE true END))`;
}

/** after() path: claims ONE row, only from {} (one statement; the row lock serialises it with a tick). */
export async function claimCapture(callRowId: string): Promise<CaptureClaim | null> {
  const claim: CaptureClaim = { v: 1, pending: true, claimedAt: new Date().toISOString(), token: randomUUID(), attempt: 1 };
  const rows = await db
    .update(campaignCalls)
    .set({ extracted: claim as unknown as Record<string, unknown> })
    .where(and(eq(campaignCalls.id, callRowId), sql`${campaignCalls.extracted} = '{}'::jsonb`))
    .returning({ id: campaignCalls.id });
  return rows.length > 0 ? claim : null;
}

/**
 * Cron catch-up: claims up to `limit` connected campaign calls created after
 * the cut-off, with a non-empty transcript and a non-empty campaign schema,
 * oldest first, in ONE statement. FOR UPDATE SKIP LOCKED: a concurrent tick
 * skips rows this one is claiming, and the outer WHERE re-checks
 * claimable() on the row's latest version, so a row claimed meanwhile (by a
 * tick or by after()) is never claimed twice.
 */
export async function claimCaptureBatch(limit: number, w: CatchUpWindow): Promise<HeldCapture[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), CAPTURE_CATCHUP_PER_TICK);
  const token = randomUUID();
  const r = (await db.execute(sql`
    UPDATE campaign_calls AS cc
       SET extracted = jsonb_build_object(
             'v', 1, 'pending', true, 'claimedAt', ${w.nowIso}::text, 'token', ${token}::text,
             'attempt', CASE WHEN cc.extracted = '{}'::jsonb THEN 1
                             WHEN jsonb_typeof(cc.extracted->'attempt') = 'number'
                               THEN (cc.extracted->>'attempt')::numeric::int + 1
                             ELSE 2 END)
      FROM campaigns AS c
     WHERE c.id = cc.campaign_id
       AND cc.id IN (
             SELECT x.id FROM campaign_calls x JOIN campaigns k ON k.id = x.campaign_id
              WHERE x.outcome = 'connected'
                AND x.created_at >= ${w.cutoffIso}::timestamptz
                AND jsonb_typeof(x.transcript) = 'array' AND jsonb_array_length(x.transcript) > 0
                AND jsonb_typeof(k.extraction_schema) = 'array' AND jsonb_array_length(k.extraction_schema) > 0
                AND ${claimable("x", w.staleBeforeIso)}
              ORDER BY x.created_at, x.id
              LIMIT ${n}
              FOR UPDATE OF x SKIP LOCKED)
       AND ${claimable("cc", w.staleBeforeIso)}
    RETURNING cc.id, cc.campaign_id, cc.user_id, cc.outcome, cc.transcript, cc.extracted, c.extraction_schema
  `)) as Rows;
  return rowsOf(r).map((row) => ({
    claim: json(row.extracted) as CaptureClaim,
    input: {
      callRowId: String(row.id),
      campaignId: String(row.campaign_id),
      userId: String(row.user_id),
      outcome: String(row.outcome) as CaptureInput["outcome"],
      transcript: (json(row.transcript) ?? []) as CaptureInput["transcript"],
      schema: json(row.extraction_schema),
    },
  }));
}

/** Eligible calls older than the cut-off, still {}: counted with a LIMIT (never a full scan count). */
export async function countCaptureOutsideWindow(w: CatchUpWindow): Promise<number> {
  const r = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM campaign_calls x JOIN campaigns k ON k.id = x.campaign_id
       WHERE x.outcome = 'connected'
         AND x.created_at < ${w.cutoffIso}::timestamptz
         AND jsonb_typeof(x.transcript) = 'array' AND jsonb_array_length(x.transcript) > 0
         AND jsonb_typeof(k.extraction_schema) = 'array' AND jsonb_array_length(k.extraction_schema) > 0
         AND x.extracted = '{}'::jsonb
       LIMIT ${CAPTURE_OUTSIDE_WINDOW_COUNT_CAP}) s
  `)) as Rows;
  return Number(rowsOf(r)[0]?.n ?? 0);
}

/** The per-tick event: counts only, no user, no ids. */
export async function logCaptureTick(m: CatchUpTickLog): Promise<void> {
  await logEvent({
    source: "web",
    event: "campaign_capture_catchup",
    level: "info",
    message: `Capture catch-up: ${m.picked} picked, ${m.outsideWindow} outside the window`,
    metadata: { picked: m.picked, outsideWindow: m.outsideWindow },
  });
}

/** Write-once: only that row, only while its extracted is still exactly our claim. */
export async function writeClaimedCapture(callRowId: string, claim: CaptureClaim, payload: unknown): Promise<boolean> {
  const rows = await db
    .update(campaignCalls)
    .set({ extracted: payload as Record<string, unknown> })
    .where(and(eq(campaignCalls.id, callRowId), sql`${campaignCalls.extracted} = ${JSON.stringify(claim)}::jsonb`))
    .returning({ id: campaignCalls.id });
  return rows.length > 0;
}

/** Not capturable after all: exhaust the claim (still pending, shown as null, never re-claimed). */
export async function parkClaimedCapture(callRowId: string, claim: CaptureClaim): Promise<void> {
  await db
    .update(campaignCalls)
    .set({ extracted: { ...claim, attempt: CAPTURE_MAX_ATTEMPTS } as unknown as Record<string, unknown> })
    .where(and(eq(campaignCalls.id, callRowId), sql`${campaignCalls.extracted} = ${JSON.stringify(claim)}::jsonb`));
}

export interface CaptureRuntime {
  llm: CaptureLlm;
  claim: CaptureDeps["claim"];
  writeClaimed: CaptureDeps["writeClaimed"];
  park: CaptureDeps["park"];
  claimBatch: CatchUpDeps["claimBatch"];
  countOutsideWindow: CatchUpDeps["countOutsideWindow"];
  logTick: CatchUpDeps["logTick"];
  /** Runs the task after the response is sent (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
}

const defaultRuntime: CaptureRuntime = {
  llm: openAiCaptureLlm,
  claim: claimCapture,
  writeClaimed: writeClaimedCapture,
  park: parkClaimedCapture,
  claimBatch: claimCaptureBatch,
  countOutsideWindow: countCaptureOutsideWindow,
  logTick: logCaptureTick,
  schedule: (task) => after(task),
};
let runtime: CaptureRuntime = defaultRuntime;

/** Tests only: swap the LLM / DB steps / scheduler. Returns a restore function. */
export function setCaptureRuntimeForTests(r: Partial<CaptureRuntime>): () => void {
  runtime = { ...defaultRuntime, ...r };
  return () => {
    runtime = defaultRuntime;
  };
}

function depsOf(r: CaptureRuntime): CatchUpDeps {
  return {
    llm: r.llm,
    claim: r.claim,
    writeClaimed: r.writeClaimed,
    park: r.park,
    claimBatch: r.claimBatch,
    countOutsideWindow: r.countOutsideWindow,
    logTick: r.logTick,
    log: (ev) => logEvent({ source: "web", ...ev }),
  };
}

/**
 * Cron tick (only when captureMode() is "on"): one bounded catch-up pass.
 * Never throws; never dials. Returns counts only.
 */
export async function runCampaignCaptureCatchUp(): Promise<CatchUpCounts> {
  try {
    return await runCaptureCatchUp(depsOf(runtime));
  } catch {
    return { claimed: 0, written: 0, skipped: 0, failed: 0 };
  }
}

/**
 * Schedules the capture after the response. Never throws into the route: a
 * scheduling failure is swallowed, the task itself never throws
 * (runCampaignCapture catches and logs).
 */
export function scheduleCampaignCapture(input: CaptureInput): void {
  const r = runtime;
  try {
    r.schedule(() => runCampaignCapture(input, depsOf(r)));
  } catch {
    // after() outside a request scope, or similar: capture is best-effort.
  }
}
