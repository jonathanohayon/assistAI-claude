// Campaign field capture (M3a) through the REAL POST /api/agent/campaign-result
// handler, against a THROWAWAY Postgres. Plain `npm test` skips it. Run it with:
//   bash scripts/campaign-capture-db.sh
// Phases (CAPTURE_DB_PHASE):
//   main   — run from an origin/main tree: POST, snapshot the response bytes
//            and the md5 of campaign_calls (minus id/created_at).
//   branch — this branch: OFF gives the same bytes and md5, zero LLM calls,
//            nothing scheduled, extracted {}; ON captures into that row only,
//            write-once, error path keeps {}.
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell. The LLM is injected: no network call. All data is mock.
// Only dynamic imports, so the `main` phase runs on origin/main's code.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.CAPTURE_DB_TEST_URL;
const phase = process.env.CAPTURE_DB_PHASE;
if (!url || !phase) {
  console.log("skip: campaign-capture DB part (no CAPTURE_DB_TEST_URL — see scripts/campaign-capture-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";
const SNAPSHOT = process.env.CAPTURE_DB_SNAPSHOT ?? "";

const U = "00000000-0000-4000-8000-0000000000a1";
const C = "00000000-0000-4000-8000-0000000000c1";
const K1 = "00000000-0000-4000-8000-0000000000b1";
const K2 = "00000000-0000-4000-8000-0000000000b2";
const SCHEMA = [
  { key: "budget", label: "Budget", type: "number", required: true },
  { key: "plan", label: "Plan", type: "enum", options: ["basic", "pro"] },
  { key: "callback_day", label: "Callback day", type: "string", required: true },
];
const TRANSCRIPT = [
  { role: "assistant", text: "Hello, mock call." },
  { role: "user", text: "My budget is 900, the pro plan." },
];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { POST } = await import("../../app/api/agent/campaign-result/route");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const reset = async () => {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM users`); // cascades to campaigns, contacts, calls
    await exec(sql`INSERT INTO users (id, email, password_hash) VALUES (${U}, 'mock-tenant@example.test', 'x')`);
    await exec(sql`INSERT INTO campaigns (id, user_id, name, status, extraction_schema) VALUES (${C}, ${U}, 'Mock campaign', 'running', ${JSON.stringify(SCHEMA)}::jsonb)`);
    await exec(sql`INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number, status, attempts) VALUES
      (${K1}, ${C}, ${U}, '+15555550101', 'calling', 1), (${K2}, ${C}, ${U}, '+15555550102', 'calling', 1)`);
  };
  const post = async (contactId: string, outcome: string, transcript: unknown = TRANSCRIPT) => {
    const res = await POST(
      new NextRequest("http://localhost/api/agent/campaign-result", {
        method: "POST",
        headers: { "x-internal-secret": "mock-internal-secret", "content-type": "application/json", "x-call-id": "mockcallid01" },
        body: JSON.stringify({ campaignId: C, contactId, outcome, transcript, durationSeconds: 30 }),
      }),
    );
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };
  const md5Calls = async () =>
    ((await exec(sql`SELECT md5(coalesce(string_agg(
        concat_ws('|', campaign_id, contact_id, user_id, call_id, phone_number, outcome, disposition, sentiment, summary,
                  transcript::text, extracted::text, duration_seconds, cost_cents, worker_call_id), ';' ORDER BY contact_id), '')) AS h
      FROM campaign_calls`)) as unknown as Array<{ h: string }>)[0]!.h;
  const extractedOf = async (contactId: string) =>
    [...((await exec(sql`SELECT id, extracted FROM campaign_calls WHERE contact_id = ${contactId}`)) as unknown as Array<{ id: string; extracted: Record<string, unknown> }>)];
  const scenario = async () => {
    const a = await post(K1, "connected");
    const b = await post(K2, "no_answer", []);
    return { responses: [a, b], md5: await md5Calls() };
  };

  if (phase === "main") {
    await reset();
    writeFileSync(SNAPSHOT, JSON.stringify(await scenario()));
    console.log("ok: origin/main snapshot written");
    return;
  }

  const main = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Awaited<ReturnType<typeof scenario>>;
  const { setCaptureRuntimeForTests, writeCaptureIfEmpty } = await import("../../lib/campaigns/capture-runtime");
  const { runCampaignCapture } = await import("../../lib/campaigns/capture");

  let llmCalls = 0;
  let llmReply: string | null = JSON.stringify({ values: { budget: "900", plan: "pro", callback_day: null, extra: "x" } });
  const tasks: Array<() => Promise<unknown>> = [];
  setCaptureRuntimeForTests({
    llm: async () => {
      llmCalls++;
      return llmReply === null ? null : { content: llmReply, model: "mock-model" };
    },
    schedule: (t) => {
      tasks.push(t);
    },
  });
  const flush = async () => {
    while (tasks.length) await tasks.shift()!();
  };

  // OFF (unset, then a non-"on" value): byte-identical to main, nothing runs
  for (const v of [undefined, "true"]) {
    if (v === undefined) delete process.env.CAMPAIGN_CAPTURE;
    else process.env.CAMPAIGN_CAPTURE = v;
    await reset();
    const off = await scenario();
    assert.deepEqual(off.responses, main.responses, "OFF: response bytes identical to origin/main");
    assert.equal(off.md5, main.md5, "OFF: campaign_calls md5 identical to origin/main");
    assert.equal(tasks.length, 0, "OFF: nothing scheduled");
    await flush();
    assert.equal(llmCalls, 0, "OFF: zero LLM calls");
    assert.equal(await md5Calls(), main.md5, "OFF: md5 unchanged after the response");
    for (const k of [K1, K2]) assert.deepEqual((await extractedOf(k))[0]!.extracted, {});
  }
  console.log(`ok: OFF: response bytes + campaign_calls md5 identical to origin/main (${main.md5}), 0 LLM calls, extracted {}`);

  // ON: same response bytes; capture runs after the response, into that row only
  process.env.CAMPAIGN_CAPTURE = "on";
  await reset();
  const on = await scenario();
  assert.deepEqual(on.responses, main.responses, "ON: response bytes unchanged too");
  assert.equal(tasks.length, 2, "one task per call; the non-connected one skips itself");
  assert.equal(on.md5, main.md5, "ON: nothing written before the response");
  await flush();
  assert.equal(llmCalls, 1, "LLM called once: only the connected call");
  const [row] = await extractedOf(K1);
  const ex = row!.extracted as Record<string, unknown>;
  assert.equal(ex.v, 1);
  assert.equal(ex.source, "conversation");
  assert.equal(ex.model, "mock-model");
  assert.ok(!Number.isNaN(Date.parse(String(ex.at))));
  assert.deepEqual(ex.values, { budget: 900, plan: "pro" });
  assert.deepEqual(ex.missing, ["callback_day"]);
  assert.deepEqual((await extractedOf(K2))[0]!.extracted, {}, "no_answer row untouched");
  console.log("ok: ON: connected row captured {budget: 900, plan: pro}, missing [callback_day]; other row {}");

  // write-once: a second capture of the same row never overwrites
  llmReply = JSON.stringify({ values: { budget: 1 } });
  const again = await runCampaignCapture(
    { callRowId: row!.id, campaignId: C, userId: U, outcome: "connected", transcript: TRANSCRIPT as never, schema: SCHEMA },
    { llm: async () => ({ content: llmReply!, model: "mock-2" }), writeIfEmpty: writeCaptureIfEmpty, log: async () => {} },
  );
  assert.equal(again, "already_set");
  assert.deepEqual((await extractedOf(K1))[0]!.extracted, ex, "unchanged");
  console.log("ok: write-once on the real row");

  // error path: LLM unavailable → extracted stays {}, a failure event with ids + reason only
  await reset();
  llmReply = null;
  await post(K1, "connected");
  await flush();
  assert.deepEqual((await extractedOf(K1))[0]!.extracted, {});
  const evs = [...((await exec(sql`SELECT metadata FROM events WHERE event = 'campaign_capture_failed'`)) as unknown as Array<{ metadata: Record<string, unknown> }>)];
  assert.equal(evs.length, 1);
  assert.deepEqual(Object.keys(evs[0]!.metadata).sort(), ["campaignCallId", "campaignId", "reason"]);
  assert.equal(evs[0]!.metadata.reason, "llm_unavailable");
  const allEvents = JSON.stringify([...((await exec(sql`SELECT message, metadata FROM events`)) as unknown as unknown[])]);
  assert.ok(!allEvents.includes("budget is 900"), "no transcript in events");
  console.log("ok: error path: extracted {} + campaign_capture_failed {campaignId, campaignCallId, reason}");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
