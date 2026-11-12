// Campaign field capture (M3a, CAMPAIGN_CAPTURE): switch parsing, validation
// per type, the run conditions, write-once, the error path, and the results
// view byte-identical to origin/main when OFF. Pure: the LLM, the write and
// the logger are injected; no network, no DB. Mock data only.
// DB part (real handler + throwaway Postgres): scripts/campaign-capture-db.sh.
// Run with:  npx tsx scripts/tests/campaign-capture.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { captureMode } from "../../lib/campaigns/capture-mode";
import {
  CAPTURE_CATCHUP_CUTOFF_HOURS,
  CAPTURE_CATCHUP_PER_TICK,
  CAPTURE_CLAIM_STALE_MINUTES,
  CAPTURE_MAX_ATTEMPTS,
  CAPTURE_MAX_FIELDS,
  CAPTURE_OUTSIDE_WINDOW_COUNT_CAP,
  CAPTURE_TRANSCRIPT_CHARS,
  captureDialog,
  captureFields,
  capturePrompt,
  capturedView,
  catchUpWindow,
  isPendingClaim,
  runCampaignCapture,
  runCaptureCatchUp,
  shouldCapture,
  validateCaptured,
  type CaptureClaim,
  type CaptureDeps,
  type CatchUpDeps,
  type CatchUpTickLog,
  type CaptureInput,
  type CapturePayload,
} from "../../lib/campaigns/capture";
import { resultsCallView, type ResultsCallRow } from "../../lib/campaigns/results-call-view";
import type { ExtractionField } from "../../lib/campaigns/constants";

const ROOT = new URL("../../", import.meta.url).pathname;

const SCHEMA: ExtractionField[] = [
  { key: "budget", label: "Budget", type: "number", required: true },
  { key: "interested", label: "Interested", type: "boolean" },
  { key: "plan", label: "Plan", type: "enum", options: ["basic", "pro"] },
  { key: "city", label: "City", type: "string" },
  { key: "callback_day", label: "Callback day", type: "string", required: true },
];
const TRANSCRIPT = [
  { role: "assistant" as const, text: "Hello, this is a mock call." },
  { role: "user" as const, text: "Hi. My budget is 1 200 and I live in Mockville." },
];
const INPUT: CaptureInput = {
  callRowId: "00000000-0000-4000-8000-0000000000d1",
  campaignId: "00000000-0000-4000-8000-0000000000c1",
  userId: "00000000-0000-4000-8000-0000000000a1",
  outcome: "connected",
  transcript: TRANSCRIPT,
  schema: SCHEMA,
};

type LogEv = Parameters<CaptureDeps["log"]>[0];
function harness(reply: string | null | Error, opts: { existing?: Record<string, unknown> } = {}) {
  const calls: Array<{ system: string; user: string }> = [];
  const logs: LogEv[] = [];
  const store: Record<string, Record<string, unknown>> = { [INPUT.callRowId]: opts.existing ?? {} };
  const deps: CaptureDeps = {
    llm: async (req) => {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return reply === null ? null : { content: reply, model: "mock-model" };
    },
    claim: async (id) => {
      if (!(id in store) || Object.keys(store[id]!).length > 0) return null;
      const c: CaptureClaim = { v: 1, pending: true, claimedAt: "2026-11-12T10:00:00.000Z", token: "mock-token", attempt: 1 };
      store[id] = c as unknown as Record<string, unknown>;
      return c;
    },
    writeClaimed: async (id, claim, payload) => {
      if (JSON.stringify(store[id]) !== JSON.stringify(claim)) return false;
      store[id] = payload as unknown as Record<string, unknown>;
      return true;
    },
    park: async (id, claim) => {
      if (JSON.stringify(store[id]) === JSON.stringify(claim)) store[id] = { ...claim, attempt: CAPTURE_MAX_ATTEMPTS };
    },
    log: async (ev) => {
      logs.push(ev);
    },
    now: () => new Date("2026-11-12T10:00:00.000Z"),
  };
  return { deps, calls, logs, store };
}

async function main() {
  // 1. switch: off unless exactly "on" (trimmed, case-insensitive)
  for (const v of [undefined, "", "off", "true", "1", "yes", "dry", "on-ish", "enabled"]) {
    assert.equal(captureMode({ CAMPAIGN_CAPTURE: v }), "off", String(v));
  }
  assert.equal(captureMode({}), "off");
  assert.equal(captureMode({ CAMPAIGN_CAPTURE: "on" }), "on");
  assert.equal(captureMode({ CAMPAIGN_CAPTURE: " ON " }), "on");
  // read in one place: no other file reads the env var
  for (const p of [
    "app/api/agent/campaign-result/route.ts",
    "app/api/dashboard/campaigns/[id]/results/route.ts",
    "lib/campaigns/capture.ts",
    "lib/campaigns/capture-runtime.ts",
    "app/api/cron/campaign-dispatch/route.ts",
  ]) {
    assert.doesNotMatch(readFileSync(ROOT + p, "utf8"), /\.CAMPAIGN_CAPTURE\b(?!_)/, p);
  }
  console.log("ok: switch parsing (off unless \"on\"), read only in capture-mode.ts");

  // 2. OFF: the route schedules nothing (the only call site is behind captureMode() === "on")
  {
    const route = readFileSync(ROOT + "app/api/agent/campaign-result/route.ts", "utf8");
    const sites = route.split("scheduleCampaignCapture(").length - 1;
    assert.equal(sites, 1, "one call site");
    assert.match(route, /if \(captureMode\(\) === "on" && inserted\) \{\n\s+scheduleCampaignCapture\(/);
    // the response is unchanged: still the one `{ ok: true }` success body
    assert.equal(route.split("NextResponse.json({ ok: true })").length - 1, 1);
    console.log("ok: OFF: capture scheduled only behind captureMode() === \"on\" (DB proof: campaign-capture-db.sh)");
  }

  // 3. ON: values validated per type; unknown keys, bad types and out-of-options enum dropped
  {
    const h = harness(
      JSON.stringify({
        values: {
          budget: "1 200",
          interested: "yes", // not a JSON boolean → dropped
          plan: "enterprise", // not in options → dropped
          city: "  Mockville  ",
          callback_day: null, // required, not found → missing
          invented: "ignored", // not in the schema → dropped
        },
      }),
    );
    const r = await runCampaignCapture(INPUT, h.deps);
    assert.equal(r, "written");
    assert.equal(h.calls.length, 1);
    const p = h.store[INPUT.callRowId] as unknown as CapturePayload;
    assert.deepEqual(p, {
      v: 1,
      source: "conversation",
      at: "2026-11-12T10:00:00.000Z",
      model: "mock-model",
      values: { budget: 1200, city: "Mockville" },
      missing: ["callback_day"],
    });
    // the log carries counts, never values or transcript text
    const done = h.logs.find((l) => l.event === "campaign_capture_done")!;
    assert.deepEqual(done.metadata, {
      campaignId: INPUT.campaignId, campaignCallId: INPUT.callRowId, written: true, captured: 2, missing: 1, fields: 5,
    });
    const logText = JSON.stringify(h.logs);
    for (const secret of ["Mockville", "1200", "1 200", "budget is"]) assert.ok(!logText.includes(secret), secret);
  }
  {
    const fields = captureFields(SCHEMA);
    const ok = validateCaptured(fields, {
      values: { budget: 42.5, interested: false, plan: "PRO", city: "x".repeat(900), callback_day: "Tuesday" },
    });
    assert.deepEqual(ok.missing, []);
    assert.equal(ok.values.budget, 42.5);
    assert.equal(ok.values.interested, false, "false is a value, kept");
    assert.equal(ok.values.plan, "pro", "enum matched to its canonical option");
    assert.equal((ok.values.city as string).length, 500, "string capped");
    // numbers: decimal comma accepted, garbage dropped; booleans strict
    for (const [v, want] of [["3,5", 3.5], ["-7", -7], ["12abc", undefined], ["", undefined], [Infinity, undefined], [true, undefined]] as const) {
      assert.equal(validateCaptured(fields, { values: { budget: v } }).values.budget, want, String(v));
    }
    for (const v of ["true", 1, "oui", null]) {
      assert.equal("interested" in validateCaptured(fields, { values: { interested: v } }).values, false, String(v));
    }
    // whitespace-only string absent; non-object replies give nothing
    assert.deepEqual(validateCaptured(fields, { values: { city: "   " } }).values, {});
    for (const raw of [null, [], "x", 3, { values: [] }, {}]) {
      assert.deepEqual(validateCaptured(fields, raw), { values: {}, missing: ["budget", "callback_day"] });
    }
    console.log("ok: ON: number parsed, boolean strict, enum only from options, string trimmed+capped, unknown keys dropped, required → missing");
  }

  // 4. nothing found → stored with empty values (the attempt is recorded), shown as {values: {}, missing}
  {
    const h = harness(JSON.stringify({ values: { budget: null } }));
    assert.equal(await runCampaignCapture(INPUT, h.deps), "written");
    const p = h.store[INPUT.callRowId] as unknown as CapturePayload;
    assert.deepEqual(p.values, {});
    assert.deepEqual(p.missing, ["budget", "callback_day"]);
    assert.deepEqual(capturedView(p), { source: "conversation", values: {}, missing: ["budget", "callback_day"] });
    // nothing found and nothing required: values {} and no missing key
    assert.deepEqual(capturedView({ v: 1, source: "conversation", at: "x", model: "m", values: {} }), { source: "conversation", values: {} });
    console.log("ok: nothing found shows captured {source, values: {}, missing}");
  }

  // 5. not run: outcome not connected, empty transcript, empty / unusable schema
  {
    const cases: Array<[string, Partial<CaptureInput>]> = [
      ["no_answer", { outcome: "no_answer" }],
      ["voicemail", { outcome: "voicemail" }],
      ["failed", { outcome: "failed" }],
      ["empty transcript", { transcript: [] }],
      ["blank transcript", { transcript: [{ role: "user", text: "" }] }],
      ["empty schema", { schema: [] }],
      ["no schema", { schema: null }],
      ["enum without options only", { schema: [{ key: "k", label: "K", type: "enum", options: [] }] }],
    ];
    for (const [name, patch] of cases) {
      const h = harness(JSON.stringify({ values: { budget: 1 } }));
      assert.equal(await runCampaignCapture({ ...INPUT, ...patch }, h.deps), "skipped", name);
      assert.equal(h.calls.length, 0, `${name}: no LLM call`);
      assert.deepEqual(h.store[INPUT.callRowId], {}, `${name}: no write`);
      assert.equal(h.logs.length, 0, `${name}: no log`);
      assert.equal(shouldCapture({ ...INPUT, ...patch }), false, name);
    }
    assert.equal(shouldCapture(INPUT), true);
    console.log("ok: not run when not connected, transcript empty, or schema empty");
  }

  // 6. write-once: an already-filled row is never overwritten
  {
    const existing = { v: 1, source: "conversation", at: "2026-11-01T00:00:00.000Z", model: "old", values: { budget: 5 } };
    const h = harness(JSON.stringify({ values: { budget: 999 } }), { existing });
    assert.equal(await runCampaignCapture(INPUT, h.deps), "already_set");
    assert.equal(h.calls.length, 0, "not claimed → no LLM call");
    assert.deepEqual(h.store[INPUT.callRowId], existing);
    // a claim held by someone else: no LLM call either
    const other: CaptureClaim = { v: 1, pending: true, claimedAt: "2026-11-12T09:59:00.000Z", token: "other", attempt: 1 };
    const h2 = harness(JSON.stringify({ values: { budget: 999 } }), { existing: other as unknown as Record<string, unknown> });
    assert.equal(await runCampaignCapture(INPUT, h2.deps), "already_set");
    assert.equal(h2.calls.length, 0);
    // the real claim takes only {} on that row id; the final write needs extracted = that claim
    const rt = readFileSync(ROOT + "lib/campaigns/capture-runtime.ts", "utf8");
    assert.match(rt, /and\(eq\(campaignCalls\.id, callRowId\), sql`\$\{campaignCalls\.extracted\} = '\{\}'::jsonb`\)/);
    assert.match(rt, /and\(eq\(campaignCalls\.id, callRowId\), sql`\$\{campaignCalls\.extracted\} = \$\{JSON\.stringify\(claim\)\}::jsonb`\)/);
    assert.match(rt, /FOR UPDATE OF x SKIP LOCKED/);
    console.log("ok: write-once through the claim (non-empty or claimed extracted: no LLM call, no write)");
  }

  // 7. error path: logged with a reason only, extracted kept {}, never throws
  {
    for (const [name, reply, reason] of [
      ["llm null", null, "llm_unavailable"],
      ["bad json", "not json", "bad_json"],
      ["llm throws", new TypeError("boom with mock prospect text"), "error:TypeError"],
    ] as const) {
      const h = harness(reply);
      assert.equal(await runCampaignCapture(INPUT, h.deps), "failed", name);
      // the claim stays (re-claimed once abandoned, attempt-bounded) and is never shown
      assert.ok(isPendingClaim(h.store[INPUT.callRowId]), `${name}: claim kept`);
      assert.equal(capturedView(h.store[INPUT.callRowId]), null, `${name}: shown as null`);
      assert.equal(h.logs.length, 1);
      assert.equal(h.logs[0]!.event, "campaign_capture_failed");
      assert.deepEqual(h.logs[0]!.metadata, { campaignId: INPUT.campaignId, campaignCallId: INPUT.callRowId, reason });
      assert.ok(!JSON.stringify(h.logs).includes("prospect text"), "no exception message in the log");
    }
    // the write itself failing, and the logger failing too: still no throw
    const h = harness(JSON.stringify({ values: { budget: 1 } }));
    h.deps.writeClaimed = async () => {
      throw new Error("db down");
    };
    h.deps.log = async () => {
      throw new Error("log down");
    };
    assert.equal(await runCampaignCapture(INPUT, h.deps), "failed");
    console.log("ok: error path logs campaign_capture_failed (no transcript/values), keeps the pending claim (shown as null)");
  }

  // 8. cost guard + prompt
  {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: "string" }));
    assert.equal(captureFields(many).length, CAPTURE_MAX_FIELDS);
    assert.deepEqual(captureFields([...SCHEMA, { key: "budget", label: "dup", type: "string" }]).map((f) => f.key), SCHEMA.map((f) => f.key));
    const long = [{ role: "user" as const, text: "a".repeat(50_000) }];
    assert.equal(captureDialog(long).length, CAPTURE_TRANSCRIPT_CHARS);
    const h = harness(JSON.stringify({ values: {} }));
    await runCampaignCapture({ ...INPUT, transcript: long, schema: many }, h.deps);
    assert.ok(h.calls[0]!.user.length <= CAPTURE_TRANSCRIPT_CHARS + 20);
    const prompt = capturePrompt(captureFields(SCHEMA));
    assert.match(prompt, /ONLY what the PROSPECT explicitly said/);
    assert.match(prompt, /Never guess/);
    assert.match(prompt, /null/);
    assert.match(prompt, /any language/);
    assert.match(prompt, /"options":\["basic","pro"\]/);
    console.log("ok: cost guard (≤ 20 fields, ≤ 12000 chars) + prompt rules");
  }

  // 9. display: results view byte-identical to origin/main when OFF; `captured` only when ON
  {
    const row = (extracted: unknown, over: Partial<ResultsCallRow> = {}): ResultsCallRow => ({
      id: "00000000-0000-4000-8000-0000000000d1",
      phoneNumber: "+15555550100",
      outcome: "connected",
      durationSeconds: 12,
      disposition: "success",
      sentiment: "positive",
      summary: "Mock summary",
      transcript: TRANSCRIPT,
      createdAt: new Date("2026-11-01T10:00:00.000Z"),
      extracted,
      ...over,
    });
    // verbatim copy of origin/main's inline mapping in the results route
    const mainView = (c: ResultsCallRow) => ({
      id: c.id,
      phoneNumber: c.phoneNumber,
      outcome: c.outcome,
      durationSeconds: c.durationSeconds ?? 0,
      success: c.disposition || null,
      sentiment: c.sentiment || null,
      summary: c.summary || "",
      transcript: Array.isArray(c.transcript) ? c.transcript : [],
      createdAt: c.createdAt.toISOString(),
    });
    const stored: CapturePayload = { v: 1, source: "conversation", at: "x", model: "m", values: { budget: 1200 }, missing: ["callback_day"] };
    const rows = [
      row({}),
      row(stored),
      row({}, { outcome: "no_answer", durationSeconds: null, disposition: "", sentiment: "", summary: "", transcript: null }),
    ];
    for (const r of rows) {
      assert.equal(JSON.stringify(resultsCallView(r, "off")), JSON.stringify(mainView(r)), "OFF byte-identical to main");
      assert.equal("captured" in resultsCallView(r, "off"), false);
    }
    assert.deepEqual(resultsCallView(rows[0]!, "on"), { ...mainView(rows[0]!), captured: null });
    const onView = resultsCallView(rows[1]!, "on") as { captured: unknown };
    assert.deepEqual(onView.captured, { source: "conversation", values: { budget: 1200 }, missing: ["callback_day"] });
    // the view never exposes model / at / v
    assert.deepEqual(Object.keys(onView.captured as object), ["source", "values", "missing"]);
    for (const bad of [null, {}, [], { values: { a: 1 } }, { v: 2, source: "conversation", values: { a: 1 } }, "x",
      { v: 1, source: "conversation", values: [] }]) {
      assert.equal(capturedView(bad), null);
    }
    // a pending claim is NEVER shown as captured (even if it somehow carried values)
    const pending = { v: 1, pending: true, claimedAt: "2026-11-12T10:00:00.000Z", token: "t", attempt: 1 };
    assert.equal(capturedView(pending), null);
    assert.equal(capturedView({ ...pending, source: "conversation", values: { budget: 1 } }), null);
    assert.equal((resultsCallView(row(pending), "on") as { captured: unknown }).captured, null);
    assert.equal(JSON.stringify(resultsCallView(row(pending), "off")), JSON.stringify(mainView(row(pending))), "OFF unchanged for a claim too");
    console.log("ok: results view: OFF byte-identical to origin/main (no `captured` key), ON adds captured | null");
  }

  // 10. catch-up pass (pure): bounds, window, park, counts, the counts-only tick log
  {
    assert.equal(CAPTURE_CATCHUP_PER_TICK, 10);
    assert.equal(CAPTURE_CATCHUP_CUTOFF_HOURS, 72);
    assert.equal(CAPTURE_CLAIM_STALE_MINUTES, 10);
    assert.equal(CAPTURE_MAX_ATTEMPTS, 3);
    assert.equal(CAPTURE_OUTSIDE_WINDOW_COUNT_CAP, 1000);
    assert.deepEqual(catchUpWindow(new Date("2026-11-12T10:00:00.000Z")), {
      nowIso: "2026-11-12T10:00:00.000Z",
      cutoffIso: "2026-11-09T10:00:00.000Z",
      staleBeforeIso: "2026-11-12T09:50:00.000Z",
    });
    const mk = (id: string, patch: Partial<CaptureInput> = {}) => ({
      input: { ...INPUT, callRowId: id, ...patch },
      claim: { v: 1 as const, pending: true as const, claimedAt: "2026-11-12T10:00:00.000Z", token: "tick", attempt: 1 },
    });
    const run = async (held: ReturnType<typeof mk>[], outside: number, reply: string | null = JSON.stringify({ values: { budget: 7 } })) => {
      const h = harness(reply);
      for (const x of held) h.store[x.input.callRowId] = x.claim as unknown as Record<string, unknown>;
      const ticks: CatchUpTickLog[] = [];
      let limitSeen = 0;
      const deps: CatchUpDeps = {
        ...h.deps,
        claimBatch: async (limit, w) => {
          limitSeen = limit;
          assert.equal(w.nowIso, "2026-11-12T10:00:00.000Z");
          return held;
        },
        countOutsideWindow: async () => outside,
        logTick: async (m) => {
          ticks.push(m);
        },
      };
      const counts = await runCaptureCatchUp(deps);
      return { h, ticks, counts, limitSeen };
    };
    const a = await run([mk("r1"), mk("r2"), mk("r3", { outcome: "no_answer" })], 4);
    assert.equal(a.limitSeen, CAPTURE_CATCHUP_PER_TICK);
    assert.deepEqual(a.counts, { claimed: 3, written: 2, skipped: 1, failed: 0 });
    assert.equal(a.h.calls.length, 2, "one LLM call per capturable held call; the held claim is used (no re-claim)");
    assert.equal((a.h.store.r1 as unknown as CapturePayload).source, "conversation");
    assert.deepEqual(a.h.store.r3, { ...mk("r3").claim, attempt: CAPTURE_MAX_ATTEMPTS }, "not capturable: claim parked (exhausted)");
    // the tick log: exactly {picked, outsideWindow}, two numbers, nothing else
    assert.deepEqual(a.ticks, [{ picked: 3, outsideWindow: 4 }]);
    assert.deepEqual(Object.keys(a.ticks[0]!).sort(), ["outsideWindow", "picked"]);
    for (const v of Object.values(a.ticks[0]!)) assert.equal(typeof v, "number");
    // nothing to say → no log; outsideWindow alone → a log; the count is capped
    assert.deepEqual((await run([], 0)).ticks, []);
    assert.deepEqual((await run([], 2)).ticks, [{ picked: 0, outsideWindow: 2 }]);
    assert.deepEqual((await run([], 5000)).ticks, [{ picked: 0, outsideWindow: CAPTURE_OUTSIDE_WINDOW_COUNT_CAP }]);
    // LLM down: counted as failed, the claim stays pending
    const f = await run([mk("r1")], 0, null);
    assert.deepEqual(f.counts, { claimed: 1, written: 0, skipped: 0, failed: 1 });
    assert.ok(isPendingClaim(f.h.store.r1));
    // a failing claim query: nothing claimed, no throw
    const h = harness(null);
    const broken: CatchUpDeps = {
      ...h.deps,
      claimBatch: async () => {
        throw new Error("db down");
      },
      countOutsideWindow: async () => 0,
      logTick: async () => {},
    };
    assert.deepEqual(await runCaptureCatchUp(broken), { claimed: 0, written: 0, skipped: 0, failed: 0 });
    // the cron route: OFF keeps the exact old path; the catch-up only behind captureMode() === "on"
    const cron = readFileSync(ROOT + "app/api/cron/campaign-dispatch/route.ts", "utf8");
    assert.match(cron, /if \(captureMode\(\) !== "on"\) \{\n\s+const result = await dispatchDueJobs\(limit\);\n\s+return NextResponse\.json\(\{ ok: true, \.\.\.result \}\);\n\s+\}/);
    assert.equal(cron.split("runCampaignCaptureCatchUp(").length - 1, 1);
    assert.doesNotMatch(cron, /dialContact|dialOneNow/, "the catch-up never dials");
    console.log("ok: catch-up pass: per-tick bound, 72 h window, held claim reused, park, counts, tick log {picked, outsideWindow} only");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
