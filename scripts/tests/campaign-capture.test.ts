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
  CAPTURE_MAX_FIELDS,
  CAPTURE_TRANSCRIPT_CHARS,
  captureDialog,
  captureFields,
  capturePrompt,
  capturedView,
  runCampaignCapture,
  shouldCapture,
  validateCaptured,
  type CaptureDeps,
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
    writeIfEmpty: async (id, payload) => {
      if (!(id in store) || Object.keys(store[id]!).length > 0) return false;
      store[id] = payload as unknown as Record<string, unknown>;
      return true;
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

  // 4. nothing found → stored with empty values (the attempt is recorded), shown as null
  {
    const h = harness(JSON.stringify({ values: { budget: null } }));
    assert.equal(await runCampaignCapture(INPUT, h.deps), "written");
    const p = h.store[INPUT.callRowId] as unknown as CapturePayload;
    assert.deepEqual(p.values, {});
    assert.deepEqual(p.missing, ["budget", "callback_day"]);
    assert.equal(capturedView(p), null);
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
    assert.deepEqual(h.store[INPUT.callRowId], existing);
    // the real write is conditional on extracted = '{}' and targets the row id
    const rt = readFileSync(ROOT + "lib/campaigns/capture-runtime.ts", "utf8");
    assert.match(rt, /and\(eq\(campaignCalls\.id, callRowId\), sql`\$\{campaignCalls\.extracted\} = '\{\}'::jsonb`\)/);
    console.log("ok: write-once (non-empty extracted never overwritten)");
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
      assert.deepEqual(h.store[INPUT.callRowId], {}, `${name}: kept {}`);
      assert.equal(h.logs.length, 1);
      assert.equal(h.logs[0]!.event, "campaign_capture_failed");
      assert.deepEqual(h.logs[0]!.metadata, { campaignId: INPUT.campaignId, campaignCallId: INPUT.callRowId, reason });
      assert.ok(!JSON.stringify(h.logs).includes("prospect text"), "no exception message in the log");
    }
    // the write itself failing, and the logger failing too: still no throw
    const h = harness(JSON.stringify({ values: { budget: 1 } }));
    h.deps.writeIfEmpty = async () => {
      throw new Error("db down");
    };
    h.deps.log = async () => {
      throw new Error("log down");
    };
    assert.equal(await runCampaignCapture(INPUT, h.deps), "failed");
    console.log("ok: error path logs campaign_capture_failed (no transcript/values) and keeps {}");
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
    for (const bad of [null, {}, { values: { a: 1 } }, { v: 2, source: "conversation", values: { a: 1 } }, "x"]) {
      assert.equal(capturedView(bad), null);
    }
    console.log("ok: results view: OFF byte-identical to origin/main (no `captured` key), ON adds captured | null");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
