// Post-call analysis of campaign calls: pure rules (lib/campaigns/analysis.ts)
// and source guards. The results GET never analyses nor writes; the worker's
// campaign-result route schedules it once; the cron tick catches up. The DB
// behaviour is proven by scripts/campaign-analysis-db.sh. Mock data only; the
// LLM is injected, no network call.
// Run with:  npx tsx scripts/tests/campaign-analysis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANALYSIS_CATCHUP_CUTOFF_HOURS,
  ANALYSIS_CATCHUP_PER_TICK,
  ANALYSIS_MAX_ATTEMPTS,
  isAnalysisPending,
  runAnalysisCatchUp,
  runCampaignAnalysis,
  shouldAnalyze,
  type AnalysisDeps,
  type HeldAnalysis,
} from "../../lib/campaigns/analysis";
import { ANALYSIS_AUTH_FAILED, analyzeCampaignCall } from "../../lib/campaigns/analyze";
import { campaignCallPublicColumns } from "../../lib/campaigns/campaign-call-row";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const TRANSCRIPT = [{ role: "user" as const, text: "Mock prospect line." }];
const held = (n: number): HeldAnalysis => ({
  claim: { v: 1, pending: true, claimedAt: "2026-11-15T10:00:00.000Z", token: `t${n}`, attempt: 1 },
  input: { callRowId: `row-${n}`, campaignId: "camp", userId: "user", transcript: TRANSCRIPT, objective: "o", successCriteria: "s", language: null },
});

function deps(over: Partial<AnalysisDeps> = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const writes: string[] = [];
  const releases: Array<{ id: string; previous: unknown }> = [];
  const alerts: number[] = [];
  const asked: number[] = [];
  const d: AnalysisDeps = {
    llm: async () => ({ success: "success", sentiment: "neutral", summary: "Mock summary" }),
    claimOne: async (id) => ({ ...held(0), input: { ...held(0).input, callRowId: id } }),
    claimBatch: async (limit) => {
      asked.push(limit);
      return Array.from({ length: Math.min(limit, 25) }, (_, i) => held(asked.length * 100 + i));
    },
    writeClaimed: async (id) => {
      writes.push(id);
      return true;
    },
    releaseClaim: async (id, _claim, previous) => {
      releases.push({ id, previous });
      return true;
    },
    alertAuthFailed: async () => {
      alerts.push(1);
    },
    countOutsideWindow: async () => 0,
    logTick: async () => {},
    log: async (ev) => {
      logs.push(ev as unknown as Record<string, unknown>);
    },
    ...over,
  };
  return { d, logs, writes, releases, alerts, asked };
}

async function run() {
  await test("the results GET never calls the LLM and never writes", () => {
    const route = read("app/api/dashboard/campaigns/[id]/results/route.ts");
    assert.doesNotMatch(route, /analyzeCampaignCall|@\/lib\/campaigns\/analyze"|analysis-runtime/);
    assert.doesNotMatch(route, /\.(update|insert|delete|execute)\(/);
    assert.doesNotMatch(route, /maxDuration/);
  });

  await test("campaign-result schedules the analysis exactly once, for the inserted row", () => {
    const route = read("app/api/agent/campaign-result/route.ts");
    assert.equal(route.split("scheduleCampaignAnalysis(").length - 1, 1);
    assert.match(route, /if \(inserted && shouldAnalyze\(outcome, transcript\)\) \{\n\s+scheduleCampaignAnalysis\(inserted\.id\);/);
    const rt = read("lib/campaigns/analysis-runtime.ts");
    assert.match(rt, /schedule: \(task\) => after\(task\)/, "scheduled with next/server after()");
  });

  await test("the cron tick runs the analysis catch-up on every tick and never dials", () => {
    const cron = read("app/api/cron/campaign-dispatch/route.ts");
    assert.equal(cron.split("runCampaignAnalysisCatchUp(").length - 1, 1);
    assert.match(cron, /finally \{\n\s+await analysis;/);
    const rt = read("lib/campaigns/analysis-runtime.ts") + read("lib/campaigns/analysis.ts");
    assert.doesNotMatch(rt, /dialContact|dialOneNow|CAMPAIGN_DISPATCH|captureMode/, "independent of dispatch and capture");
  });

  await test("shouldAnalyze: connected with a non-empty transcript only", () => {
    assert.equal(shouldAnalyze("connected", TRANSCRIPT), true);
    assert.equal(shouldAnalyze("connected", []), false);
    assert.equal(shouldAnalyze("no_answer", TRANSCRIPT), false);
    assert.equal(shouldAnalyze("connected", null), false);
  });

  await test("isAnalysisPending: unanalysed, within the window, attempts left", () => {
    const now = new Date("2026-11-15T12:00:00.000Z");
    const base = { outcome: "connected", transcript: TRANSCRIPT, disposition: "", summary: "", createdAt: new Date("2026-11-15T11:00:00.000Z"), analysisClaim: null };
    assert.equal(isAnalysisPending(base, now), true);
    assert.equal(isAnalysisPending({ ...base, disposition: "fail" }, now), false, "analysed (empty summary)");
    assert.equal(isAnalysisPending({ ...base, summary: "x" }, now), false);
    assert.equal(isAnalysisPending({ ...base, outcome: "busy" }, now), false);
    const old = new Date(now.getTime() - (ANALYSIS_CATCHUP_CUTOFF_HOURS * 3600 + 60) * 1000);
    assert.equal(isAnalysisPending({ ...base, createdAt: old }, now), false, "outside the window: never analysed");
    const exhausted = { v: 1, pending: true, token: "t", attempt: ANALYSIS_MAX_ATTEMPTS, claimedAt: "2026-11-15T11:00:00.000Z" };
    assert.equal(isAnalysisPending({ ...base, analysisClaim: exhausted }, now), false, "attempts exhausted");
    assert.equal(isAnalysisPending({ ...base, analysisClaim: { ...exhausted, claimedAt: "2026-11-15T11:58:00.000Z" } }, now), true, "last attempt running");
    assert.equal(isAnalysisPending({ ...base, analysisClaim: { ...exhausted, attempt: 1 } }, now), true);
  });

  await test("the catch-up claims at most ANALYSIS_CATCHUP_PER_TICK per tick (one first, then the rest)", async () => {
    const { d, writes, asked } = deps();
    const c = await runAnalysisCatchUp(d);
    assert.deepEqual(asked, [1, ANALYSIS_CATCHUP_PER_TICK - 1]);
    assert.deepEqual(c, { claimed: ANALYSIS_CATCHUP_PER_TICK, written: ANALYSIS_CATCHUP_PER_TICK, failed: 0, skipped: 0 });
    assert.equal(writes.length, ANALYSIS_CATCHUP_PER_TICK);
  });

  await test("an LLM failure (null or throw) never throws; logged without transcript", async () => {
    for (const llm of [async () => null, async () => Promise.reject(new TypeError("mock"))]) {
      const { d, logs, writes, releases, alerts } = deps({ llm, claimBatch: async (n) => (n === 1 ? [held(1)] : []) });
      const c = await runAnalysisCatchUp(d);
      assert.deepEqual(c, { claimed: 1, written: 0, failed: 1, skipped: 0 });
      assert.equal(writes.length, 0);
      assert.equal(releases.length, 0, "the attempt is consumed: the claim stays");
      assert.equal(alerts.length, 0);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.event, "campaign_analysis_failed");
      assert.ok(!JSON.stringify(logs).includes("Mock prospect"));
    }
  });

  await test("a failing claim query, logger or count never throws", async () => {
    const boom = async () => {
      throw new Error("mock");
    };
    assert.deepEqual(await runAnalysisCatchUp(deps({ claimBatch: boom }).d), { claimed: 0, written: 0, failed: 0, skipped: 0 });
    assert.equal(await runCampaignAnalysis("row", deps({ claimOne: boom }).d), "failed");
    const { d } = deps({ llm: async () => null, log: boom, countOutsideWindow: boom, claimBatch: async (n) => (n === 1 ? [held(1)] : []) });
    assert.deepEqual(await runAnalysisCatchUp(d), { claimed: 1, written: 0, failed: 1, skipped: 0 });
  });

  await test("after() path: no claim → no LLM call", async () => {
    let calls = 0;
    const { d } = deps({ claimOne: async () => null, llm: async () => (calls++, null) });
    assert.equal(await runCampaignAnalysis("row", d), "already_done");
    assert.equal(calls, 0);
  });

  const MOCK_KEY = "sk-mock-0000-NOT-A-REAL-KEY";
  const ANALYZE_IN = { transcript: TRANSCRIPT, objective: "o", successCriteria: "s", language: "en" };
  const reply = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  const echoKey = (status: number) =>
    reply(status, JSON.stringify({ error: { message: `Incorrect API key provided: ${MOCK_KEY}`, code: "invalid_api_key" } }));

  await test("analyze(): a 401 or 403 from the provider is a typed auth_failed, never the key", async () => {
    for (const status of [401, 403]) {
      let auth = "";
      const fetchMock = (async (_u: unknown, init?: RequestInit) => {
        auth = String((init?.headers as Record<string, string>).Authorization);
        return echoKey(status)("");
      }) as unknown as typeof fetch;
      const r = await analyzeCampaignCall(ANALYZE_IN, { fetch: fetchMock, apiKey: MOCK_KEY });
      assert.equal(r, ANALYSIS_AUTH_FAILED, `HTTP ${status}`);
      assert.equal(auth, `Bearer ${MOCK_KEY}`, "the mock transport was used");
      assert.ok(!JSON.stringify(r).includes(MOCK_KEY));
    }
  });

  await test("analyze(): 500, 429, a timeout, bad JSON stay null (an attempt), as before", async () => {
    assert.equal(await analyzeCampaignCall(ANALYZE_IN, { fetch: echoKey(500), apiKey: MOCK_KEY }), null);
    assert.equal(await analyzeCampaignCall(ANALYZE_IN, { fetch: echoKey(429), apiKey: MOCK_KEY }), null);
    const timeout = (async () => {
      throw new DOMException("mock timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    assert.equal(await analyzeCampaignCall(ANALYZE_IN, { fetch: timeout, apiKey: MOCK_KEY }), null);
    const badJson = reply(200, JSON.stringify({ choices: [{ message: { content: "not json" } }] }));
    assert.equal(await analyzeCampaignCall(ANALYZE_IN, { fetch: badJson, apiKey: MOCK_KEY }), null);
    const ok = reply(200, JSON.stringify({ choices: [{ message: { content: '{"success":"partial","sentiment":"positive","summary":"Mock"}' } }] }));
    assert.deepEqual(await analyzeCampaignCall(ANALYZE_IN, { fetch: ok, apiKey: MOCK_KEY }), { success: "partial", sentiment: "positive", summary: "Mock" });
    assert.equal(await analyzeCampaignCall(ANALYZE_IN, { fetch: echoKey(401), apiKey: "" }), null, "no key: null, nothing sent");
  });

  await test("catch-up: a rejected key releases the claim, pauses the tick, raises the alert", async () => {
    const prev = { v: 1, pending: true, claimedAt: "2026-11-15T09:00:00.000Z", token: "old", attempt: 1 };
    let llmCalls = 0;
    const { d, logs, writes, releases, alerts, asked } = deps({
      llm: async () => (llmCalls++, ANALYSIS_AUTH_FAILED),
      claimBatch: async (n) => (asked.push(n), [{ ...held(1), previousClaim: prev }]),
    });
    const c = await runAnalysisCatchUp(d);
    assert.deepEqual(c, { claimed: 1, written: 0, failed: 0, skipped: 1, authFailed: true });
    assert.deepEqual(asked, [1], "nothing else claimed in that tick");
    assert.equal(llmCalls, 1);
    assert.deepEqual(releases, [{ id: "row-1", previous: prev }], "back to the previous claim");
    assert.equal(alerts.length, 1);
    assert.equal(writes.length, 0);
    assert.deepEqual(logs.map((l) => l.event), ["campaign_analysis_auth_failed"], "not logged as a failed attempt");
  });

  await test("catch-up: a rejected key in the rest of the batch releases those claims too", async () => {
    let n = 0;
    const { d, releases, writes } = deps({
      llm: async () => (++n > 3 ? ANALYSIS_AUTH_FAILED : { success: "success", sentiment: "neutral", summary: "Mock" }),
    });
    const c = await runAnalysisCatchUp(d);
    assert.equal(c.claimed, ANALYSIS_CATCHUP_PER_TICK);
    assert.equal(c.written, 3);
    assert.equal(c.failed, 0);
    assert.equal(c.skipped, ANALYSIS_CATCHUP_PER_TICK - 3);
    assert.equal(c.authFailed, true);
    assert.equal(releases.length, ANALYSIS_CATCHUP_PER_TICK - 3);
    assert.equal(writes.length, 3);
  });

  await test("after() path: a rejected key releases the claim (no attempt), one alert", async () => {
    const { d, releases, alerts } = deps({ llm: async () => ANALYSIS_AUTH_FAILED });
    assert.equal(await runCampaignAnalysis("row-x", d), "auth_failed");
    assert.deepEqual(releases, [{ id: "row-x", previous: null }]);
    assert.equal(alerts.length, 1);
  });

  await test("a failing release or alert never throws", async () => {
    const boom = async () => {
      throw new Error("mock");
    };
    const { d } = deps({ llm: async () => ANALYSIS_AUTH_FAILED, releaseClaim: boom, alertAuthFailed: boom, log: boom });
    assert.equal(await runCampaignAnalysis("row-x", d), "auth_failed");
    const c = await runAnalysisCatchUp(deps({ llm: async () => ANALYSIS_AUTH_FAILED, releaseClaim: boom, alertAuthFailed: boom }).d);
    assert.equal(c.authFailed, true);
  });

  await test("the auth-failure alert: deduped key, 6 h, the agreed text, env var names only", () => {
    const rt = read("lib/campaigns/analysis-runtime.ts");
    assert.match(rt, /key: "campaign_analysis_auth_failed"/);
    assert.match(rt, /dedupMs: 6 \* 60 \* 60 \* 1000/);
    assert.match(rt, /The model provider rejected the API key; campaign analysis is paused\./);
    assert.match(rt, /alertAuthFailed: \(\) => alertAdmins\(AUTH_FAILED_ALERT\)/);
    const body = rt.slice(rt.indexOf("export const AUTH_FAILED_ALERT"), rt.indexOf("};", rt.indexOf("export const AUTH_FAILED_ALERT")));
    assert.doesNotMatch(body, /process\.env|transcript|\$\{/, "no env value, no transcript, no interpolation");
  });

  await test("the claim column is never returned by the campaign detail route", () => {
    assert.ok(!("analysisClaim" in campaignCallPublicColumns));
    assert.ok(!("workerCallId" in campaignCallPublicColumns));
  });

  await test("migration 0053 is add-only and sorts after every earlier migration", () => {
    const tag = "0053_campaign_calls_analysis_claim";
    const m = read(`drizzle/${tag}.sql`);
    assert.equal(m.trim(), 'ALTER TABLE "campaign_calls" ADD COLUMN IF NOT EXISTS "analysis_claim" jsonb;');
    const j = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string; when: number }> };
    const i = j.entries.findIndex((e) => e.tag === tag);
    assert.ok(i >= 0, "journal entry present");
    // Every EARLIER migration sorts before it (later ones sort after).
    for (const e of j.entries.slice(0, i)) assert.ok(e.when < j.entries[i]!.when, `${e.tag} sorts before ${tag}`);
  });

  console.log(`\n${passed} campaign-analysis tests passed`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
