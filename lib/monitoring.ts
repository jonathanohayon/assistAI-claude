// Production monitoring (SERVER-ONLY): worker heartbeat, key status, daily
// synthetic check + digest. Pure rules in lib/monitoring-rules.ts.

import { and, eq, gte, sql } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { calls, events } from "@/lib/db/schema";
import {
  type WorkerHeartbeat,
  deadKeys,
  formatDigest,
  heartbeatProblem,
} from "@/lib/monitoring-rules";
import { getSetting, setSetting } from "@/lib/settings";

const HEARTBEAT_SETTING = "worker_heartbeat";
const HOUR = 3600_000;

export async function recordHeartbeat(hb: Omit<WorkerHeartbeat, "at">): Promise<void> {
  await setSetting(HEARTBEAT_SETTING, JSON.stringify({ ...hb, at: Date.now() }));
}

export async function readHeartbeat(): Promise<WorkerHeartbeat | null> {
  try {
    const raw = await getSetting(HEARTBEAT_SETTING);
    return raw ? (JSON.parse(raw) as WorkerHeartbeat) : null;
  } catch {
    return null;
  }
}

/** Every 5 min: worker alive + model keys valid. */
export async function runMonitorTick(now = Date.now()) {
  const hb = await readHeartbeat();
  const problem = heartbeatProblem(hb, now);
  if (problem) {
    await alertAdmins({
      key: "worker_heartbeat_stale",
      subject: "Voice agent DOWN: no worker heartbeat",
      body: problem,
      dedupMs: HOUR,
      severity: "critical",
    });
  }
  const dead = deadKeys(hb);
  for (const k of dead) {
    await alertAdmins({
      key: `model_key_invalid:${k}`,
      subject: `Model API key rejected: ${k}`,
      body:
        `The worker's read-only check of the ${k} key was rejected (401/403).\n` +
        "Calls on this engine fail until the key is rotated on the worker (Railway).",
      dedupMs: 24 * HOUR,
      severity: "critical",
    });
  }
  return { heartbeat: hb, problem, deadKeys: dead };
}

async function synthetic(): Promise<{ config: number | "error"; greeting: number | "error" } | null> {
  const phone = process.env.MONITOR_TEST_PHONE?.trim();
  const appUrl = process.env.APP_URL?.trim();
  const secret = process.env.INTERNAL_SECRET;
  if (!phone || !appUrl || !secret) return null;
  const get = async (path: string): Promise<number | "error"> => {
    try {
      const res = await fetch(`${appUrl}${path}?phone=${encodeURIComponent(phone)}`, {
        headers: { "x-internal-secret": secret },
        signal: AbortSignal.timeout(10_000),
      });
      await res.arrayBuffer().catch(() => undefined);
      return res.status;
    } catch {
      return "error";
    }
  };
  return { config: await get("/api/agent/config"), greeting: await get("/api/agent/greeting-audio") };
}

/** Daily: synthetic check of the call path + digest to the founder. */
export async function runDailyDigest(now = Date.now()) {
  const since = new Date(now - 24 * HOUR);
  const [c] = await db
    .select({
      n: sql<number>`count(*)::int`,
      secs: sql<number>`coalesce(sum(${calls.durationSeconds}),0)::int`,
    })
    .from(calls)
    .where(gte(calls.createdAt, since));
  const [b] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.event, "book_success"), gte(events.createdAt, since)));
  const topErrors = await db
    .select({ event: events.event, n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.level, "error"), gte(events.createdAt, since)))
    .groupBy(events.event)
    .orderBy(sql`2 desc`)
    .limit(3);
  const errors = topErrors.reduce((a, t) => a + t.n, 0);
  const hb = await readHeartbeat();
  const syn = await synthetic();

  const text = formatDigest({
    calls: c?.n ?? 0,
    callSeconds: c?.secs ?? 0,
    bookings: b?.n ?? 0,
    errors,
    topErrors,
    heartbeatAgeMin: hb ? Math.round((now - hb.at) / 60_000) : null,
    synthetic: syn,
  });
  const synOk = !syn || (syn.config === 200 && (syn.greeting === 200 || syn.greeting === 204));
  if (!synOk) {
    await alertAdmins({
      key: "synthetic_check_failed",
      subject: "Synthetic check FAILED: the call path is broken",
      body: text,
      dedupMs: 12 * HOUR,
      severity: "critical",
    });
  }
  // The digest itself: one per day (dedup 20 h), a warning (respects quiet hours).
  await alertAdmins({
    key: "daily_digest",
    subject: "Daily digest",
    body: text,
    dedupMs: 20 * HOUR,
    severity: "warning",
  });
  return { text, synthetic: syn };
}
