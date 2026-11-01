// Periodic production health checks that alert the admins — SERVER-ONLY.
// Called from the hourly billing cron (see app/api/cron/billing).

import { and, eq, gte, sql } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

const HOUR = 60 * 60 * 1000;

/** Error events in the last hour above which something is broken, not noisy. */
export const ERROR_RATE_THRESHOLD = 50;

export type KeyCheck = "ok" | "invalid" | "unreachable" | "missing";

/**
 * GET /v1/models with the web's OpenAI key: 200 = valid, 401/403 = dead.
 * The worker has its own env; its failures surface as realtime_fatal_error
 * (alerted from /api/events). Read-only, costs nothing.
 */
export async function checkOpenAiKey(): Promise<KeyCheck> {
  const key = process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) return "missing";
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return "invalid";
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function runHealthChecks(): Promise<{
  openaiKey: KeyCheck;
  errorsLastHour: number;
}> {
  const openaiKey = await checkOpenAiKey();
  if (openaiKey === "invalid" || openaiKey === "missing") {
    await alertAdmins({
      key: "openai_key_invalid",
      subject: "OpenAI API key rejected",
      body:
        `GET https://api.openai.com/v1/models with the production key returned ${openaiKey === "missing" ? "no key configured" : "401/403"}.\n\n` +
        `The voice agent cannot answer calls until the key is rotated on Railway (web AND worker: OPENAI_API_KEY).`,
      dedupMs: 24 * HOUR,
    });
  }

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.level, "error"), gte(events.createdAt, new Date(Date.now() - HOUR))));
  const errorsLastHour = row?.n ?? 0;
  if (errorsLastHour > ERROR_RATE_THRESHOLD) {
    const top = await db
      .select({ event: events.event, n: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.level, "error"), gte(events.createdAt, new Date(Date.now() - HOUR))))
      .groupBy(events.event)
      .orderBy(sql`2 desc`)
      .limit(5);
    await alertAdmins({
      key: "error_rate",
      subject: `${errorsLastHour} errors in the last hour`,
      body:
        `${errorsLastHour} level=error events in the last hour (threshold ${ERROR_RATE_THRESHOLD}).\n\n` +
        `Top events:\n${top.map((t) => `  ${t.n}  ${t.event}`).join("\n")}\n\n` +
        `Details: /admin logs, or the events table.`,
      dedupMs: 6 * HOUR,
    });
  }

  return { openaiKey, errorsLastHour };
}
