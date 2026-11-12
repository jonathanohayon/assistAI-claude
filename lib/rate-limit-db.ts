// Shared DB-backed rate limiter — SERVER-ONLY. One call per attempt:
//
//   const rl = await consumeRateLimit({ bucket: "email_test", accountId, windowMs, perAccount, global });
//   if (!rl.ok) return 429 { error: "rate_limited", scope: rl.scope } (+ Retry-After: rl.retryAfterSec)
//
// - ok → the attempt is ALREADY recorded (before the caller acts), so
//   concurrent requests can't all slip under the limit.
// - Counts are shared across requests, replicas and restarts (not in memory).
// - accountId = the account the action is FOR (the ?asUserId target for admins).
//
// Storage, no migration: one app_settings row per bucket (key
// "rate_limit:<bucket>") holding { accountId: [epoch ms, ...] } for the
// window (lib/rate-limit-db-core.ts; no address, no number). One transaction
// locks that row (SELECT … FOR UPDATE), decides and writes; concurrent calls
// on the same bucket queue on the row lock, other buckets are independent.
// Why not count `events` rows: events has no index on (event, created_at),
// so every call would scan the table while holding the lock; this ledger is
// bounded by `global` entries. Time comes from the database clock, so all
// replicas agree on the window.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  assertRateLimitInput,
  decideRateLimit,
  parseRateLimitLedger,
  type RateLimitResult,
} from "@/lib/rate-limit-db-core";

export type { RateLimitResult } from "@/lib/rate-limit-db-core";

type Rows = unknown[] | { rows: unknown[] };
const rowsOf = (r: Rows): unknown[] => (Array.isArray(r) ? r : r.rows);

export async function consumeRateLimit(opts: {
  bucket: string; // e.g. "email_test", "whatsapp_test", "test_call"
  accountId: string; // the account the action is for (the asUserId target for admins)
  windowMs: number; // rolling window
  perAccount: number; // max attempts per account per window
  global: number; // max attempts across all accounts per window
}): Promise<RateLimitResult> {
  const { bucket, accountId, windowMs, perAccount, global } = opts;
  assertRateLimitInput(bucket, accountId, { windowMs, perAccount, global });
  const key = `rate_limit:${bucket}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, '{}', now())
      ON CONFLICT (key) DO NOTHING
    `);
    const [row] = rowsOf(
      (await tx.execute(sql`
        SELECT value, (extract(epoch from clock_timestamp()) * 1000)::bigint AS now_ms
          FROM app_settings WHERE key = ${key} FOR UPDATE
      `)) as Rows,
    ) as { value: string; now_ms: string | number }[];
    const now = Number(row.now_ms);
    const { result, next } = decideRateLimit(parseRateLimitLedger(row.value), accountId, now, {
      windowMs,
      perAccount,
      global,
    });
    await tx.execute(sql`
      UPDATE app_settings SET value = ${JSON.stringify(next)}, updated_at = now() WHERE key = ${key}
    `);
    return result;
  });
}
