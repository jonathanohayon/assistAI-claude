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
  const d: AnalysisDeps = {
    llm: async () => ({ success: "success", sentiment: "neutral", summary: "Mock summary" }),
    claimOne: async (id) => ({ ...held(0), input: { ...held(0).input, callRowId: id } }),
    claimBatch: async (limit) => Array.from({ length: Math.min(limit, 25) }, (_, i) => held(i)),
    writeClaimed: async (id) => {
      writes.push(id);
      return true;
    },
    countOutsideWindow: async () => 0,
    logTick: async () => {},
    log: async (ev) => {
      logs.push(ev as unknown as Record<string, unknown>);
    },
    ...over,
  };
  return { d, logs, writes };
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

  await test("the catch-up claims at most ANALYSIS_CATCHUP_PER_TICK per tick", async () => {
    let asked = -1;
    const { d, writes } = deps({ claimBatch: async (limit) => ((asked = limit), Array.from({ length: limit }, (_, i) => held(i))) });
    const c = await runAnalysisCatchUp(d);
    assert.equal(asked, ANALYSIS_CATCHUP_PER_TICK);
    assert.deepEqual(c, { claimed: ANALYSIS_CATCHUP_PER_TICK, written: ANALYSIS_CATCHUP_PER_TICK, failed: 0, skipped: 0 });
    assert.equal(writes.length, ANALYSIS_CATCHUP_PER_TICK);
  });

  await test("an LLM failure (null or throw) never throws; logged without transcript", async () => {
    for (const llm of [async () => null, async () => Promise.reject(new TypeError("mock"))]) {
      const { d, logs, writes } = deps({ llm, claimBatch: async () => [held(1)] });
      const c = await runAnalysisCatchUp(d);
      assert.deepEqual(c, { claimed: 1, written: 0, failed: 1, skipped: 0 });
      assert.equal(writes.length, 0);
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
    const { d } = deps({ llm: async () => null, log: boom, countOutsideWindow: boom, claimBatch: async () => [held(1)] });
    assert.deepEqual(await runAnalysisCatchUp(d), { claimed: 1, written: 0, failed: 1, skipped: 0 });
  });

  await test("after() path: no claim → no LLM call", async () => {
    let calls = 0;
    const { d } = deps({ claimOne: async () => null, llm: async () => (calls++, null) });
    assert.equal(await runCampaignAnalysis("row", d), "already_done");
    assert.equal(calls, 0);
  });

  await test("the claim column is never returned by the campaign detail route", () => {
    assert.ok(!("analysisClaim" in campaignCallPublicColumns));
    assert.ok(!("workerCallId" in campaignCallPublicColumns));
  });

  await test("migration 0052 is add-only and sorts last", () => {
    const m = read("drizzle/0052_campaign_calls_analysis_claim.sql");
    assert.equal(m.trim(), 'ALTER TABLE "campaign_calls" ADD COLUMN IF NOT EXISTS "analysis_claim" jsonb;');
    const j = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string; when: number }> };
    const last = j.entries[j.entries.length - 1]!;
    assert.equal(last.tag, "0052_campaign_calls_analysis_claim");
    assert.ok(j.entries.slice(0, -1).every((e) => e.when < last.when));
  });

  console.log(`\n${passed} campaign-analysis tests passed`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
