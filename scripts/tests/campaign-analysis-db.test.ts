// Post-call analysis (success verdict, sentiment, summary) moved out of the
// results GET, through the REAL route handlers against a THROWAWAY Postgres.
// Plain `npm test` skips it. Run it with:  bash scripts/campaign-analysis-db.sh
// Phases (ANALYSIS_DB_PHASE):
//   main   — run from an origin/main tree: the results GET of a campaign whose
//            calls are all analysed, the worker's POST /api/agent/campaign-result
//            and a cron tick (dispatch off): snapshot their bytes.
//   branch — this branch: same bytes; the GET makes 0 LLM calls and 0 writes;
//            campaign-result schedules the analysis once; after() + an
//            overlapping tick analyse once; the catch-up is bounded, oldest
//            first, within the window; an LLM failure never crashes and is
//            retried at most ANALYSIS_MAX_ATTEMPTS times.
// The session is a test double (campaigns-plan-gate module hooks). The LLM is
// injected: no network call. The dispatch tick runs with CAMPAIGN_DISPATCH
// off: it never dials. Only a 127.0.0.1/localhost URL is accepted;
// DATABASE_URL is never read from the shell. All data is mock.
// Only dynamic imports, so the `main` phase runs on origin/main's code.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.ANALYSIS_DB_TEST_URL;
const phase = process.env.ANALYSIS_DB_PHASE;
if (!url || !phase) {
  console.log("skip: campaign-analysis DB part (no ANALYSIS_DB_TEST_URL — see scripts/campaign-analysis-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO)|OPENAI|REALTIME_API_KEY/i.test(k))) {
  throw new Error("refusing to run with LiveKit/Twilio/OpenAI env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/campaign-analysis-db.sh");
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";
const SNAPSHOT = process.env.ANALYSIS_DB_SNAPSHOT ?? "";

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const AGENT = id(0xa1);
const DONE = id(0xc1); // every call analysed
const OPEN = id(0xc2); // calls waiting for their analysis
const K = (n: number) => id(0xb00 + n);
const TRANSCRIPT = [
  { role: "assistant", text: "Hello, mock call." },
  { role: "user", text: "Mock prospect line, please call me back." },
];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { GET: RESULTS } = await import("../../app/api/dashboard/campaigns/[id]/results/route");
  const { POST } = await import("../../app/api/agent/campaign-result/route");
  const { GET: CRON } = await import("../../app/api/cron/campaign-dispatch/route");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await exec(q)) as unknown as T[] | { rows: T[] };
    return Array.isArray(r) ? r : r.rows;
  };

  const reset = async () => {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM users`); // cascades to campaigns, contacts, calls, agents
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.test', 'x', 'admin')`);
    await exec(sql`INSERT INTO outbound_agents (id, user_id, name, language) VALUES (${AGENT}, ${ADMIN}, 'Mock agent', 'en')`);
    await exec(sql`INSERT INTO campaigns (id, user_id, name, status, objective, success_criteria, agent_id) VALUES
      (${DONE}, ${ADMIN}, 'Mock analysed', 'running', 'Mock objective', 'Mock criteria', ${AGENT}),
      (${OPEN}, ${ADMIN}, 'Mock open', 'running', 'Mock objective 2', 'Mock criteria 2', ${AGENT})`);
    const contacts = Array.from({ length: 20 }, (_, i) => sql`(${K(i)}, ${i < 4 ? DONE : OPEN}, ${ADMIN}, ${`+1555555${String(1000 + i)}`}, 'calling', 1)`);
    await exec(sql`INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number, status, attempts) VALUES ${sql.join(contacts, sql`, `)}`);
  };
  /** The analysed campaign: fixed timestamps, so main and branch return the same bytes. */
  const seedAnalysed = async () => {
    await exec(sql`INSERT INTO campaign_calls (id, campaign_id, contact_id, user_id, phone_number, outcome, disposition, sentiment, summary, transcript, duration_seconds, created_at) VALUES
      (${id(0xd1)}, ${DONE}, ${K(0)}, ${ADMIN}, '+15555551000', 'connected', 'success', 'positive', 'Mock summary one', ${JSON.stringify(TRANSCRIPT)}::jsonb, 61, '2026-11-10T09:00:00Z'),
      (${id(0xd2)}, ${DONE}, ${K(1)}, ${ADMIN}, '+15555551001', 'connected', 'partial', 'neutral', 'Mock summary two', ${JSON.stringify(TRANSCRIPT)}::jsonb, 42, '2026-11-10T10:00:00Z'),
      (${id(0xd3)}, ${DONE}, ${K(2)}, ${ADMIN}, '+15555551002', 'connected', 'fail', 'negative', 'Mock summary three', ${JSON.stringify(TRANSCRIPT)}::jsonb, 15, '2026-11-11T08:30:00Z'),
      (${id(0xd4)}, ${DONE}, ${K(3)}, ${ADMIN}, '+15555551003', 'no_answer', '', '', '', '[]'::jsonb, 0, '2026-11-11T08:40:00Z')`);
  };
  const ctx = (cid: string) => ({ params: Promise.resolve({ id: cid }) });
  const results = async (cid: string) => {
    g.__campgateSession = { user: { id: ADMIN } };
    const res = await RESULTS(new NextRequest(`http://localhost/api/dashboard/campaigns/${cid}/results`), ctx(cid));
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };
  const post = async (contactId: string, campaignId: string, outcome: string, transcript: unknown = TRANSCRIPT) => {
    const res = await POST(
      new NextRequest("http://localhost/api/agent/campaign-result", {
        method: "POST",
        headers: { "x-internal-secret": "mock-internal-secret", "content-type": "application/json", "x-call-id": "mockcallid01" },
        body: JSON.stringify({ campaignId, contactId, outcome, transcript, durationSeconds: 30 }),
      }),
    );
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };
  const tick = async () => {
    const res = await CRON(new NextRequest("http://localhost/api/cron/campaign-dispatch", { headers: { "x-internal-secret": "mock-internal-secret" } }));
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };
  /** Every column of campaign_calls that exists on both trees (analysis_claim added on the branch). */
  const md5Calls = async (withClaim: boolean) =>
    (await rows<{ h: string }>(sql`SELECT md5(coalesce(string_agg(concat_ws('|', id, campaign_id, contact_id, user_id, call_id, phone_number,
        outcome, disposition, sentiment, summary, transcript::text, extracted::text, duration_seconds, cost_cents, created_at, worker_call_id
        ${withClaim ? sql`, coalesce(analysis_claim::text, '<null>')` : sql``}), ';' ORDER BY id), '')) AS h FROM campaign_calls`))[0]!.h;
  const postScenario = async () => {
    const a = await post(K(10), OPEN, "connected");
    const b = await post(K(11), OPEN, "no_answer", []);
    return [a, b];
  };

  if (phase === "main") {
    await reset();
    await seedAnalysed();
    const analysed = await results(DONE);
    const posts = await postScenario();
    delete process.env.CAMPAIGN_DISPATCH;
    const cron = await tick();
    writeFileSync(SNAPSHOT, JSON.stringify({ analysed, posts, cron }));
    console.log("ok: origin/main snapshot written");
    return;
  }

  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
    analysed: Awaited<ReturnType<typeof results>>;
    posts: Awaited<ReturnType<typeof postScenario>>;
    cron: Awaited<ReturnType<typeof tick>>;
  };
  const { setAnalysisRuntimeForTests } = await import("../../lib/campaigns/analysis-runtime");
  const { ANALYSIS_CATCHUP_PER_TICK, ANALYSIS_MAX_ATTEMPTS, ANALYSIS_CATCHUP_CUTOFF_HOURS } = await import("../../lib/campaigns/analysis");

  type Reply = { success: "success" | "partial" | "fail"; sentiment: "positive" | "neutral" | "negative"; summary: string };
  let llmCalls = 0;
  let llmDelayMs = 0;
  let llmMode: "ok" | "null" | "throw" = "ok";
  const llmSeen: Array<{ objective: string; successCriteria: string; language?: string | null }> = [];
  const tasks: Array<() => Promise<unknown>> = [];
  const install = (enabled = true) =>
    setAnalysisRuntimeForTests({
      enabled: () => enabled,
      llm: async (o) => {
        llmCalls++;
        llmSeen.push({ objective: o.objective, successCriteria: o.successCriteria, language: o.language });
        if (llmDelayMs) await new Promise((r) => setTimeout(r, llmDelayMs));
        if (llmMode === "throw") throw new TypeError("mock failure");
        if (llmMode === "null") return null;
        return { success: "partial", sentiment: "positive", summary: "Mock analysis summary" } satisfies Reply;
      },
      schedule: (t) => {
        tasks.push(t);
      },
    });
  let restore = install();
  const fresh = () => {
    llmCalls = 0;
    llmDelayMs = 0;
    llmMode = "ok";
    llmSeen.length = 0;
    tasks.length = 0;
  };
  const call = async (rowId: string) =>
    (await rows<{ disposition: string; sentiment: string; summary: string; analysis_claim: Record<string, unknown> | null }>(
      sql`SELECT disposition, sentiment, summary, analysis_claim FROM campaign_calls WHERE id = ${rowId}`,
    ))[0]!;
  /** A connected call after() missed: inserted directly, unanalysed. */
  const insertMissed = async (contactId: string, ageSql: string, claim: unknown = null) =>
    (await rows<{ id: string }>(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, outcome, transcript, analysis_claim, created_at)
      VALUES (${OPEN}, ${contactId}, ${ADMIN}, '+15555550199', 'connected', ${JSON.stringify(TRANSCRIPT)}::jsonb,
              ${claim === null ? null : JSON.stringify(claim)}::jsonb, now() - ${ageSql}::interval) RETURNING id`))[0]!.id;
  const tickEvents = async () =>
    rows<{ event: string; metadata: Record<string, unknown> }>(sql`SELECT event, metadata FROM events WHERE event LIKE 'campaign_analysis%' ORDER BY created_at`);

  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    fresh();
    await reset();
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  };

  await test("the GET of an analysed campaign is byte-identical to origin/main", async () => {
    await seedAnalysed();
    const now = await results(DONE);
    assert.deepEqual(now, snap.analysed);
    assert.equal(llmCalls, 0);
  });

  await test("the GET makes 0 LLM calls and 0 writes on unanalysed calls; they show as not analysed", async () => {
    await seedAnalysed();
    const a = await insertMissed(K(10), "5 minutes");
    await insertMissed(K(11), "4 minutes");
    await insertMissed(K(12), `${ANALYSIS_CATCHUP_CUTOFF_HOURS + 1} hours`);
    const before = await md5Calls(true);
    const eventsBefore = (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM events`))[0]!.n;
    const res = await results(OPEN);
    assert.equal(res.status, 200);
    assert.equal(llmCalls, 0, "no LLM call");
    assert.equal(tasks.length, 0, "nothing scheduled");
    assert.equal(await md5Calls(true), before, "campaign_calls unchanged");
    assert.equal((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM events`))[0]!.n, eventsBefore, "no event written");
    const body = JSON.parse(res.body) as { aggregates: Record<string, unknown>; calls: Array<Record<string, unknown>> };
    const one = body.calls.find((c) => c.id === a)!;
    assert.equal(one.success, null);
    assert.equal(one.sentiment, null);
    assert.equal(one.summary, "");
    assert.equal(body.aggregates.analyzedNow, 0);
    assert.equal(body.aggregates.pendingAnalysis, 2, "the call outside the window is not pending");
    assert.ok(!("analysisClaim" in one) && !res.body.includes("analysis_claim"), "the claim is never returned");
  });

  await test("the campaign-result response is byte-identical; the analysis is scheduled once, after it", async () => {
    const now = await postScenario();
    assert.deepEqual(now, snap.posts);
    assert.equal(tasks.length, 1, "one task, for the connected call only");
    assert.equal(llmCalls, 0, "nothing ran before the response");
    const [row] = await rows<{ id: string }>(sql`SELECT id FROM campaign_calls WHERE contact_id = ${K(10)}`);
    assert.equal((await call(row!.id)).disposition, "");
    assert.equal(await tasks[0]!(), "written");
    assert.equal(llmCalls, 1);
    assert.deepEqual(llmSeen[0], { objective: "Mock objective 2", successCriteria: "Mock criteria 2", language: "en" });
    assert.deepEqual(await call(row!.id), { disposition: "partial", sentiment: "positive", summary: "Mock analysis summary", analysis_claim: null });
    // Run again (a duplicated after()): nothing more.
    assert.equal(await tasks[0]!(), "already_done");
    assert.equal(llmCalls, 1);
  });

  await test("the cron response bytes are unchanged", async () => {
    await postScenario();
    tasks.length = 0;
    delete process.env.CAMPAIGN_DISPATCH;
    assert.deepEqual(await tick(), snap.cron);
    assert.equal(llmCalls, 1, "the tick caught the call after() did not run");
  });

  await test("after() + an overlapping tick: analysed once", async () => {
    await post(K(10), OPEN, "connected");
    const [row] = await rows<{ id: string }>(sql`SELECT id FROM campaign_calls WHERE contact_id = ${K(10)}`);
    llmDelayMs = 150;
    const [afterRes] = await Promise.all([tasks[0]!(), tick(), tick()]);
    assert.ok(afterRes === "written" || afterRes === "already_done");
    assert.equal(llmCalls, 1, "one LLM call in all");
    assert.equal((await call(row!.id)).summary, "Mock analysis summary");
    await tick();
    assert.equal(llmCalls, 1, "never analysed again");
  });

  await test("two overlapping ticks over missed calls: each analysed once", async () => {
    for (let i = 0; i < 6; i++) await insertMissed(K(10 + i), `${10 - i} minutes`);
    llmDelayMs = 100;
    await Promise.all([tick(), tick(), tick()]);
    assert.equal(llmCalls, 6);
    const n = (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM campaign_calls WHERE summary = 'Mock analysis summary' AND analysis_claim IS NULL`))[0]!.n;
    assert.equal(n, 6);
  });

  await test("the catch-up is bounded per tick, oldest first, and respects the window", async () => {
    const ids: string[] = [];
    for (let i = 0; i < ANALYSIS_CATCHUP_PER_TICK + 3; i++) ids.push(await insertMissed(K(i + 4), `${60 - i} minutes`));
    const old = await insertMissed(K(19), `${ANALYSIS_CATCHUP_CUTOFF_HOURS} hours 1 minute`);
    await tick();
    assert.equal(llmCalls, ANALYSIS_CATCHUP_PER_TICK, "bounded");
    for (let i = 0; i < ids.length; i++) {
      const done = (await call(ids[i]!)).summary !== "";
      assert.equal(done, i < ANALYSIS_CATCHUP_PER_TICK, `oldest first (#${i})`);
    }
    await tick();
    assert.equal(llmCalls, ids.length, "the rest on the next tick");
    await tick();
    assert.equal(llmCalls, ids.length, "the call outside the window is never picked");
    assert.deepEqual(await call(old), { disposition: "", sentiment: "", summary: "", analysis_claim: null });
    const ev = await tickEvents();
    assert.ok(ev.length >= 1 && ev.every((e) => e.event === "campaign_analysis_catchup"));
    assert.deepEqual(Object.keys(ev[0]!.metadata).sort(), ["outsideWindow", "picked"], "counts only");
    assert.equal(ev[0]!.metadata.outsideWindow, 1);
  });

  await test("an LLM failure never crashes; retried at most ANALYSIS_MAX_ATTEMPTS times", async () => {
    const a = await insertMissed(K(10), "5 minutes");
    llmMode = "null";
    const r = await tick();
    assert.equal(r.status, 200);
    let c = await call(a);
    assert.equal(c.summary, "");
    assert.equal(c.analysis_claim?.attempt, 1, "the claim stays");
    await tick();
    assert.equal(llmCalls, 1, "a fresh failed claim is not retried at once");
    llmMode = "throw";
    for (let attempt = 2; attempt <= ANALYSIS_MAX_ATTEMPTS + 1; attempt++) {
      // Age the claim past the stale delay: the next tick may re-claim it.
      await exec(sql`UPDATE campaign_calls SET analysis_claim = jsonb_set(analysis_claim, '{claimedAt}', to_jsonb(${new Date(Date.now() - 11 * 60_000).toISOString()}::text)) WHERE id = ${a}`);
      const t = await tick();
      assert.equal(t.status, 200, "no crash on a throwing LLM");
    }
    assert.equal(llmCalls, ANALYSIS_MAX_ATTEMPTS, "at most N attempts");
    c = await call(a);
    assert.equal(c.analysis_claim?.attempt, ANALYSIS_MAX_ATTEMPTS);
    assert.equal(c.summary, "");
    const fails = (await tickEvents()).filter((e) => e.event === "campaign_analysis_failed");
    assert.equal(fails.length, ANALYSIS_MAX_ATTEMPTS);
    for (const f of fails) {
      assert.deepEqual(Object.keys(f.metadata).sort(), ["attempt", "campaignCallId", "campaignId", "reason"]);
      assert.ok(!JSON.stringify(f.metadata).includes("Mock prospect"), "no transcript in the log");
    }
  });

  await test("an analysis whose claim was lost is never written", async () => {
    const a = await insertMissed(K(10), "5 minutes");
    llmDelayMs = 100;
    const pending = tick();
    await new Promise((r) => setTimeout(r, 30));
    // Someone else analysed it meanwhile (e.g. a manual fix): our write must not land.
    await exec(sql`UPDATE campaign_calls SET disposition = 'fail', summary = 'Other summary' WHERE id = ${a}`);
    await pending;
    assert.equal((await call(a)).summary, "Other summary");
  });

  await test("without a provider key nothing is claimed, scheduled or analysed", async () => {
    restore();
    restore = install(false);
    const a = await insertMissed(K(10), "5 minutes");
    await post(K(11), OPEN, "connected");
    await tick();
    assert.equal(tasks.length, 0);
    assert.equal(llmCalls, 0);
    assert.equal((await call(a)).analysis_claim, null, "no attempt burnt");
    restore();
    restore = install();
  });

  restore();
  console.log(`\n${passed} campaign-analysis DB tests passed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
