// Shared DB-backed rate limiter (lib/rate-limit-db.ts, lib/rate-limit-db-core.ts).
// Part 1 (always): the pure decision. Part 2 (only with RATE_LIMIT_DB_TEST_URL,
// a THROWAWAY local Postgres — see scripts/rate-limit-db.sh): per-account
// limit, global limit, rolling window, 20 parallel calls → exactly N ok,
// buckets independent, nothing but ids + timestamps stored.
// Run with:  npx tsx scripts/tests/rate-limit-db.test.ts

import assert from "node:assert/strict";

import { assertRateLimitInput, decideRateLimit, parseRateLimitLedger } from "../../lib/rate-limit-db-core";

const RULE = { windowMs: 60_000, perAccount: 3, global: 5 };

// ── Part 1: pure ──────────────────────────────────────────────────────────
{
  const now = 1_000_000;
  let l = {};
  for (let i = 0; i < 3; i++) {
    const d = decideRateLimit(l, "a", now + i * 1000, RULE);
    assert.deepEqual(d.result, { ok: true }, `a #${i + 1}`);
    l = d.next;
  }
  // 4th for a → account; retry when a's oldest (t=now) leaves the window.
  assert.deepEqual(decideRateLimit(l, "a", now + 3000, RULE).result, { ok: false, scope: "account", retryAfterSec: 57 });
  // b gets 2, then the global ceiling (5) hits c.
  for (let i = 0; i < 2; i++) l = decideRateLimit(l, "b", now + 4000, RULE).next;
  assert.deepEqual(decideRateLimit(l, "c", now + 5000, RULE).result, { ok: false, scope: "global", retryAfterSec: 55 });
  // Rolling window: at now+60s a's first attempt has left → a gets one more.
  const later = decideRateLimit(l, "a", now + 60_000, RULE);
  assert.deepEqual(later.result, { ok: true });
  assert.deepEqual(later.next.a, [now + 1000, now + 2000, now + 60_000], "expired entries dropped");
  // Rejections are not recorded.
  const before = JSON.stringify(l);
  decideRateLimit(l, "a", now + 3000, RULE);
  assert.equal(JSON.stringify(decideRateLimit(l, "a", now + 3000, RULE).next), before);

  assert.deepEqual(parseRateLimitLedger("{bad"), {});
  assert.deepEqual(parseRateLimitLedger("[1]"), {});
  assert.deepEqual(parseRateLimitLedger('{"a":[1,"x"],"b":3}'), { a: [1] });
  assert.throws(() => assertRateLimitInput("Bad Bucket", "a", RULE));
  assert.throws(() => assertRateLimitInput("ok", "", RULE));
  assert.throws(() => assertRateLimitInput("ok", "a", { ...RULE, global: 0 }));
  assert.throws(() => assertRateLimitInput("ok", "a", { ...RULE, perAccount: 1.5 }));
  assertRateLimitInput("email_test", "a", RULE);
  console.log("rate-limit-db pure part passed");
}

// ── Part 2: real Postgres ─────────────────────────────────────────────────
const url = process.env.RATE_LIMIT_DB_TEST_URL;
if (!url) {
  console.log("SKIPPED rate-limit-db DB part (set RATE_LIMIT_DB_TEST_URL — see scripts/rate-limit-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { consumeRateLimit } = await import("../../lib/rate-limit-db");
  await db.execute(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const rl = (bucket: string, accountId: string, o: Partial<typeof RULE> = {}) =>
    consumeRateLimit({ bucket, accountId, ...RULE, ...o });

  // Per-account limit.
  for (let i = 0; i < 3; i++) assert.deepEqual(await rl("t_account", A), { ok: true });
  const r4 = await rl("t_account", A);
  assert.ok(!r4.ok && r4.scope === "account" && r4.retryAfterSec >= 1 && r4.retryAfterSec <= 60, JSON.stringify(r4));
  assert.deepEqual(await rl("t_account", B), { ok: true }, "another account is not affected");

  // Global limit.
  for (let i = 0; i < 5; i++) assert.deepEqual(await rl("t_global", `acct-${i}`), { ok: true });
  const g = await rl("t_global", "acct-new");
  assert.ok(!g.ok && g.scope === "global", JSON.stringify(g));

  // Buckets independent: A is at its limit in t_account, free in t_other.
  assert.deepEqual(await rl("t_other", A), { ok: true });

  // Rolling window (database clock): 2 per 400 ms.
  const W = { windowMs: 400, perAccount: 2, global: 100 };
  assert.ok((await rl("t_window", A, W)).ok);
  assert.ok((await rl("t_window", A, W)).ok);
  assert.ok(!(await rl("t_window", A, W)).ok);
  await new Promise((r) => setTimeout(r, 450));
  assert.ok((await rl("t_window", A, W)).ok, "a slot frees once the window rolls");

  // Concurrency: 20 parallel calls from one account → exactly perAccount ok.
  const one = await Promise.all(Array.from({ length: 20 }, () => rl("t_burst", A, { perAccount: 7, global: 100 })));
  assert.equal(one.filter((r) => r.ok).length, 7);
  assert.ok(one.every((r) => r.ok || r.scope === "account"));
  // Concurrency: 20 parallel calls from 20 accounts → exactly global ok.
  const many = await Promise.all(Array.from({ length: 20 }, (_, i) => rl("t_burst_global", `acct-${i}`, { perAccount: 5, global: 6 })));
  assert.equal(many.filter((r) => r.ok).length, 6);
  assert.ok(many.every((r) => r.ok || r.scope === "global"));
  // Concurrency across buckets: they don't block each other's counts.
  const mixed = await Promise.all(Array.from({ length: 20 }, (_, i) => rl(i % 2 ? "t_mix_a" : "t_mix_b", A, { perAccount: 4, global: 100 })));
  assert.equal(mixed.filter((r) => r.ok).length, 8);

  // Stored: ids + timestamps only; a corrupt row reads as empty.
  const rows = (await db.execute(sql`SELECT value FROM app_settings WHERE key LIKE 'rate_limit:%'`)) as unknown as { value: string }[];
  for (const r of rows) {
    for (const [k, v] of Object.entries(JSON.parse(r.value) as Record<string, unknown>)) {
      assert.ok(!k.includes("@") && Array.isArray(v) && v.every((t) => typeof t === "number"));
    }
  }
  await db.execute(sql`UPDATE app_settings SET value = '{oops' WHERE key = 'rate_limit:t_account'`);
  assert.deepEqual(await rl("t_account", A), { ok: true });

  console.log("ALL RATE-LIMIT-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
