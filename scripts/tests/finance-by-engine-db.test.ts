// Finance per engine / model (E3) against a THROWAWAY Postgres, through the
// real route (GET /api/admin/finance-stats) and the real SQL:
//   1. byEngine groups usage events by the engine/model actually used: the
//      event's metadata, else the reported call's realtime_provider /
//      realtime_model (same tenant only), else "unknown"; uncovered call time
//      is one "unmetered" group;
//   2. each group's cost follows today's per-row rule, and
//      Σ byEngine.costUsd == totals.openai;
//   3. additivity: the response body is byte-for-byte the historic
//      computation (computeFinanceStatsBase, in this tree) with byEngine
//      appended last — global and per-tenant scope;
//   4. no PII in byEngine (no email, no tenant id, no call id, no number).
// Plain `npm test` skips it. Run it with:  bash scripts/finance-by-engine-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read
// from the shell. Mock data only (example.test).

import assert from "node:assert/strict";

const url = process.env.FINANCE_BY_ENGINE_DB_TEST_URL;
if (!url) {
  console.log("skip: finance by-engine DB part (no FINANCE_BY_ENGINE_DB_TEST_URL — see scripts/finance-by-engine-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/finance-by-engine-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const T1 = id(0x01);
const T2 = id(0x02);

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { computeFinanceStatsBase } = await import("../../lib/finance/cost");
  const { getCostRates } = await import("../../lib/finance/rates-storage");
  const route = await import("../../app/api/admin/finance-stats/route");

  const at = new Date(Date.now() - 86400_000).toISOString();
  const from = new Date(Date.now() - 20 * 86400_000);
  const to = new Date(Date.now() + 86400_000);

  for (const [uid, role] of [[ADMIN, "admin"], [T1, "user"], [T2, "user"]] as const)
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${uid}, ${`${uid.slice(-2)}@finance.example.test`}, 'x', ${role})`);
  const call = (uid: string, callId: string, seconds: number, provider: string | null, model: string | null) =>
    db.execute(sql`INSERT INTO calls (user_id, call_id, from_number, to_number, duration_seconds, realtime_provider, realtime_model, created_at)
                   VALUES (${uid}, ${callId}, '+15550000301', '+15550000302', ${seconds}, ${provider}, ${model}, ${at})`);
  const usage = (uid: string, meta: Record<string, unknown>) =>
    db.execute(sql`INSERT INTO events (user_id, source, event, message, metadata, created_at)
                   VALUES (${uid}, 'agent', 'openai_usage', 'mock usage', ${JSON.stringify(meta)}::jsonb, ${at})`);
  const tok = (inputTokens: number, outputTokens = 0, cachedTokens = 0) => ({ inputTokens, outputTokens, cachedTokens });

  // T1
  await call(T1, "k1", 120, "openai", "gpt-realtime-2");
  await call(T1, "k2", 180, "xai", "grok-voice-3.0");
  await call(T1, "k3", 60, "gemini", "gemini-live-2.5");
  await call(T1, "k4", 600, "openai", "gpt-realtime-2"); // no usage event → unmetered
  // event carries provider + model
  await usage(T1, { callId: "k1", provider: "openai", model: "gpt-realtime-2", ...tok(10_000, 5_000), durationSeconds: 120, costUsd: 9.99 });
  // event carries provider, no model → the call's model
  await usage(T1, { callId: "k2", provider: "xai", model: null, ...tok(0), durationSeconds: 180, costUsd: 0.24 });
  // event carries neither (an older row) → the call's engine + model, priced as OpenAI (today's rule)
  await usage(T1, { callId: "k3", ...tok(2_500), durationSeconds: 60 });
  // neither, and no call → unknown
  await usage(T1, { ...tok(1_250), durationSeconds: 60 });
  // T2: same call id as T1's k2 but another tenant's call — must not be used for T1
  await call(T2, "k2", 120, "gemini", "gemini-live-2.5");
  await usage(T2, { callId: "k2", provider: "gemini", model: "gemini-live-2.5", ...tok(100, 100), durationSeconds: 120, costUsd: 0.12 });

  const get = async (qs: string) => {
    g.__campgateSession = { user: { id: ADMIN } };
    const res = await route.GET(new NextRequest(`http://localhost/api/admin/finance-stats?granularity=month&from=${from.toISOString()}&to=${to.toISOString()}${qs}`));
    assert.equal(res.status, 200);
    return res.text();
  };
  const rates = await getCostRates();

  // ── Global scope ───────────────────────────────────────────────────────
  const text = await get("");
  const body = JSON.parse(text);
  const want = [
    // uncovered: 1080 s of calls − 540 s covered = 540 s = 9 min × 0.3
    ["unmetered", null, "openai-per-minute-estimate", null, 9, 2.7, 0.3],
    // 10k × 0.00004 + 5k × 0.00008 (the worker's 9.99 ignored)
    ["openai", "gpt-realtime-2", "openai-flat", 1, 2, 0.8, 0.4],
    ["xai", "grok-voice-3.0", "worker-reported", 1, 3, 0.24, 0.08],
    ["gemini", "gemini-live-2.5", "worker-reported", 1, 2, 0.12, 0.06],
    ["gemini", "gemini-live-2.5", "openai-flat", 1, 1, 0.1, 0.1],
    ["unknown", null, "openai-flat", 1, 1, 0.05, 0.05],
  ];
  assert.deepEqual(
    body.byEngine.map((e: Record<string, unknown>) => [e.provider, e.model, e.rateBasis, e.calls, e.minutes, e.costUsd, e.costPerMinuteUsd]),
    want,
  );
  const sum = Math.round(body.byEngine.reduce((s: number, e: { costUsd: number }) => s + e.costUsd, 0) * 100) / 100;
  assert.equal(body.totals.openai, 4.01);
  assert.equal(sum, body.totals.openai, "Σ byEngine.costUsd == totals.openai");

  // Additivity, byte level: the body is the base's bytes with byEngine appended.
  const additive = async (text: string, userId: string | null) => {
    const base = await computeFinanceStatsBase({ rates, from, to, granularity: "month", userId });
    const baseText = JSON.stringify(base);
    const { byEngine, ...rest } = JSON.parse(text);
    assert.equal(JSON.stringify(rest), baseText, "response minus byEngine == computeFinanceStatsBase");
    assert.equal(text, `${baseText.slice(0, -1)},"byEngine":${JSON.stringify(byEngine)}}`, "byEngine appended last, nothing else moved");
    return { base, baseText };
  };
  const { baseText } = await additive(text, null);

  // Optional one-off (never in CI): the base vs the ORIGINAL computeFinanceStats
  // of another tree, e.g. origin/main's lib/finance/cost.ts copied locally.
  if (process.env.FINANCE_MAIN_MODULE) {
    const main = await import(process.env.FINANCE_MAIN_MODULE);
    const mainText = JSON.stringify(await main.computeFinanceStats({ rates, from, to, granularity: "month", userId: null }));
    assert.equal(mainText, baseText, "base == the other tree's computeFinanceStats");
    const mainT1 = JSON.stringify(await main.computeFinanceStats({ rates, from, to, granularity: "month", userId: T1 }));
    assert.equal(mainT1, JSON.stringify(await computeFinanceStatsBase({ rates, from, to, granularity: "month", userId: T1 })));
    console.log(`  base == ${process.env.FINANCE_MAIN_MODULE} computeFinanceStats (global + tenant, ${mainText.length} bytes)`);
  }

  // ── Tenant scope (T1): T2's gemini call never leaks in, nor its call row ──
  const t1Text = await get(`&userId=${T1}`);
  const t1 = JSON.parse(t1Text);
  assert.deepEqual(
    t1.byEngine.map((e: Record<string, unknown>) => [e.provider, e.model, e.rateBasis, e.costUsd]),
    [
      ["unmetered", null, "openai-per-minute-estimate", 2.7], // 960 − 420 = 540 s
      ["openai", "gpt-realtime-2", "openai-flat", 0.8],
      ["xai", "grok-voice-3.0", "worker-reported", 0.24], // T1's own k2 call, not T2's gemini k2
      ["gemini", "gemini-live-2.5", "openai-flat", 0.1],
      ["unknown", null, "openai-flat", 0.05],
    ],
  );
  assert.equal(t1.totals.openai, 3.89);
  assert.equal(Math.round(t1.byEngine.reduce((s: number, e: { costUsd: number }) => s + e.costUsd, 0) * 100) / 100, 3.89);
  await additive(t1Text, T1);

  // ── No PII in byEngine ─────────────────────────────────────────────────
  const be = JSON.stringify([body.byEngine, t1.byEngine]);
  for (const s of ["@", "example.test", T1, T2, ADMIN, "+1555", '"k1"', '"k2"', '"k3"'])
    assert.ok(!be.includes(s), `byEngine holds no ${s}`);

  // ── Nothing in the window → byEngine is [] ─────────────────────────────
  g.__campgateSession = { user: { id: ADMIN } };
  const empty = JSON.parse(await (await route.GET(new NextRequest("http://localhost/api/admin/finance-stats?granularity=month&from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z"))).text());
  assert.deepEqual(empty.byEngine, []);

  console.log("ALL FINANCE-BY-ENGINE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
