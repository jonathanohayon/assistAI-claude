// Campaign field capture (M3a) through the REAL POST /api/agent/campaign-result
// handler, against a THROWAWAY Postgres. Plain `npm test` skips it. Run it with:
//   bash scripts/campaign-capture-db.sh
// Phases (CAPTURE_DB_PHASE):
//   main   — run from an origin/main tree: POST, then the cron tick
//            (dispatch off and dry) with a call after() missed; snapshot the
//            response bytes and the md5 of campaign_calls (minus id/created_at).
//   branch — this branch: OFF gives the same bytes and md5, zero LLM calls,
//            nothing scheduled, extracted {}; ON captures into that row only,
//            write-once through the claim, error path keeps the claim; the
//            cron catch-up (missed call, double tick, after()+tick, abandoned
//            claim, cut-off, per-tick bound, counts-only tick log).
// The dispatch tick runs only with CAMPAIGN_DISPATCH off or dry: it never dials.
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
  const { GET: CRON } = await import("../../app/api/cron/campaign-dispatch/route");

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
  const tick = async () => {
    const res = await CRON(
      new NextRequest("http://localhost/api/cron/campaign-dispatch", { headers: { "x-internal-secret": "mock-internal-secret" } }),
    );
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };
  /** A connected call after() missed: inserted directly, extracted {}, nothing scheduled. */
  const insertMissed = async (contactId: string, ageSql = "0 seconds", extracted: unknown = {}) =>
    ((await exec(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, outcome, transcript, extracted, created_at)
      VALUES (${C}, ${contactId}, ${U}, '+15555550199', 'connected', ${JSON.stringify(TRANSCRIPT)}::jsonb, ${JSON.stringify(extracted)}::jsonb,
              now() - ${ageSql}::interval) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
  const contactsMd5 = async () =>
    ((await exec(sql`SELECT md5(string_agg(concat_ws('|', id, status, claimed_at, call_state, attempts), ';' ORDER BY id)) AS h FROM campaign_contacts`)) as unknown as Array<{ h: string }>)[0]!.h;
  // The cron tick with dispatch off, then dry, over a missed call.
  const cronScenario = async () => {
    await insertMissed(K1);
    const out: Array<Awaited<ReturnType<typeof tick>>> = [];
    for (const d of [undefined, "dry"]) {
      if (d === undefined) delete process.env.CAMPAIGN_DISPATCH;
      else process.env.CAMPAIGN_DISPATCH = d;
      out.push(await tick());
    }
    delete process.env.CAMPAIGN_DISPATCH;
    return { responses: out, md5: await md5Calls(), contacts: await contactsMd5() };
  };

  if (phase === "main") {
    await reset();
    const post = await scenario();
    await reset();
    const cron = await cronScenario();
    writeFileSync(SNAPSHOT, JSON.stringify({ ...post, cron }));
    console.log("ok: origin/main snapshot written");
    return;
  }

  const main = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Awaited<ReturnType<typeof scenario>> & {
    cron: Awaited<ReturnType<typeof cronScenario>>;
  };
  const rt = await import("../../lib/campaigns/capture-runtime");
  const { setCaptureRuntimeForTests } = rt;
  const { runCampaignCapture, capturedView, isPendingClaim, CAPTURE_CATCHUP_PER_TICK, CAPTURE_MAX_ATTEMPTS } = await import("../../lib/campaigns/capture");

  let llmCalls = 0;
  let llmDelayMs = 0;
  let llmReply: string | null = JSON.stringify({ values: { budget: "900", plan: "pro", callback_day: null, extra: "x" } });
  const tasks: Array<() => Promise<unknown>> = [];
  setCaptureRuntimeForTests({
    llm: async () => {
      llmCalls++;
      if (llmDelayMs) await new Promise((r) => setTimeout(r, llmDelayMs));
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

  // OFF: the cron tick (dispatch off, then dry) over a missed call is byte-identical to main and captures nothing
  for (const v of [undefined, "true"]) {
    if (v === undefined) delete process.env.CAMPAIGN_CAPTURE;
    else process.env.CAMPAIGN_CAPTURE = v;
    await reset();
    const off = await cronScenario();
    assert.deepEqual(off.responses, main.cron.responses, "OFF: cron response bytes identical to origin/main");
    assert.equal(off.md5, main.cron.md5, "OFF: campaign_calls md5 identical to origin/main after the ticks");
    assert.equal(off.contacts, main.cron.contacts, "OFF: campaign_contacts unchanged (nothing dialled)");
    assert.equal(llmCalls, 0, "OFF: zero LLM calls on the tick");
    const evs = (await exec(sql`SELECT count(*)::int AS n FROM events WHERE event LIKE 'campaign_capture%'`)) as unknown as Array<{ n: number }>;
    assert.equal(evs[0]!.n, 0, "OFF: no capture event at all");
  }
  console.log(`ok: OFF: cron tick (dispatch off + dry) bytes + md5 identical to origin/main (${main.cron.md5}), 0 LLM calls, no event`);

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
  let again2 = 0;
  const again = await runCampaignCapture(
    { callRowId: row!.id, campaignId: C, userId: U, outcome: "connected", transcript: TRANSCRIPT as never, schema: SCHEMA },
    {
      llm: async () => {
        again2++;
        return { content: llmReply!, model: "mock-2" };
      },
      claim: rt.claimCapture,
      writeClaimed: rt.writeClaimedCapture,
      park: rt.parkClaimedCapture,
      log: async () => {},
    },
  );
  assert.equal(again, "already_set");
  assert.equal(again2, 0, "not claimable → no LLM call");
  assert.deepEqual((await extractedOf(K1))[0]!.extracted, ex, "unchanged");
  console.log("ok: write-once on the real row");

  // error path: LLM unavailable → the claim stays (pending, shown as null), a failure event with ids + reason only
  await reset();
  llmReply = null;
  await post(K1, "connected");
  await flush();
  const failed = (await extractedOf(K1))[0]!.extracted;
  assert.ok(isPendingClaim(failed), "claim kept");
  assert.equal((failed as { attempt: number }).attempt, 1);
  assert.equal(capturedView(failed), null, "a pending claim is shown as captured: null");
  const evs = [...((await exec(sql`SELECT metadata FROM events WHERE event = 'campaign_capture_failed'`)) as unknown as Array<{ metadata: Record<string, unknown> }>)];
  assert.equal(evs.length, 1);
  assert.deepEqual(Object.keys(evs[0]!.metadata).sort(), ["campaignCallId", "campaignId", "reason"]);
  assert.equal(evs[0]!.metadata.reason, "llm_unavailable");
  const allEvents = JSON.stringify([...((await exec(sql`SELECT message, metadata FROM events`)) as unknown as unknown[])]);
  assert.ok(!allEvents.includes("budget is 900"), "no transcript in events");
  console.log("ok: error path: pending claim (shown as null) + campaign_capture_failed {campaignId, campaignCallId, reason}");

  // ── Catch-up on the cron tick (CAMPAIGN_CAPTURE on; dispatch off or dry: never dials) ──
  const GOOD = JSON.stringify({ values: { budget: "900", plan: "pro", callback_day: null } });
  const byId = async (id: string) =>
    ((await exec(sql`SELECT extracted FROM campaign_calls WHERE id = ${id}`)) as unknown as Array<{ extracted: Record<string, unknown> }>)[0]!.extracted;
  const tickJson = async () => {
    const t = await tick();
    assert.equal(t.status, 200);
    return JSON.parse(t.body) as Record<string, unknown> & { capture: Record<string, number> };
  };
  const tickEvents = async () =>
    [...((await exec(sql`SELECT message, metadata, user_id FROM events WHERE event = 'campaign_capture_catchup' ORDER BY created_at`)) as unknown as Array<{ message: string; metadata: Record<string, unknown>; user_id: string | null }>)];
  const resetOn = async () => {
    await reset();
    tasks.length = 0;
    llmCalls = 0;
    llmDelayMs = 0;
    llmReply = GOOD;
  };
  process.env.CAMPAIGN_CAPTURE = "on";

  // 1. a call after() missed is captured on the next tick; dispatch off AND dry; the response adds only `capture` (counts)
  for (const d of [undefined, "dry"]) {
    await resetOn();
    if (d === undefined) delete process.env.CAMPAIGN_DISPATCH;
    else process.env.CAMPAIGN_DISPATCH = d;
    const contactsBefore = await contactsMd5();
    const id = await insertMissed(K1);
    const body = await tickJson();
    const offBody = JSON.parse(main.cron.responses[d === undefined ? 0 : 1]!.body) as Record<string, unknown>;
    const { capture, ...rest } = body;
    if (d === undefined) assert.deepEqual(rest, offBody, "ON: the dispatch part of the response unchanged");
    else assert.deepEqual(Object.keys(rest), Object.keys(offBody));
    assert.deepEqual(capture, { claimed: 1, written: 1, skipped: 0, failed: 0 });
    assert.equal(llmCalls, 1);
    const ex = await byId(id);
    assert.deepEqual(ex.values, { budget: 900, plan: "pro" });
    assert.deepEqual(ex.missing, ["callback_day"]);
    assert.equal(await contactsMd5(), contactsBefore, "nothing dialled, no contact touched");
    // second tick: nothing left
    assert.deepEqual((await tickJson()).capture, { claimed: 0, written: 0, skipped: 0, failed: 0 });
    assert.equal(llmCalls, 1);
  }
  delete process.env.CAMPAIGN_DISPATCH;
  console.log("ok: catch-up: a missed call is captured on the next tick (dispatch off and dry), never dials, response adds counts-only `capture`");

  // 2. the tick log: counts only, exactly {picked, outsideWindow}; nothing when there is nothing to say
  {
    const evs = await tickEvents();
    assert.equal(evs.length, 1, "one event for the tick that picked, none for the empty tick");
    assert.deepEqual(evs[0]!.metadata, { picked: 1, outsideWindow: 0 });
    assert.equal(evs[0]!.user_id, null, "no user/tenant id");
    assert.ok(!/budget|900|Mock|\+1555|[0-9a-f]{8}-[0-9a-f]{4}/i.test(JSON.stringify(evs)), "no ids, transcripts or values");
  }
  console.log("ok: tick log campaign_capture_catchup {picked, outsideWindow} only (two numbers, no ids/values)");

  // 3. nothing found → stored values {} + missing, shown as {values: {}, missing}
  {
    await resetOn();
    llmReply = JSON.stringify({ values: { budget: null, plan: null, callback_day: null } });
    const id = await insertMissed(K1);
    await tickJson();
    assert.deepEqual(capturedView(await byId(id)), { source: "conversation", values: {}, missing: ["budget", "callback_day"] });
  }
  console.log("ok: nothing found → captured {source, values: {}, missing}");

  // 4. two ticks run concurrently capture once (exactly 1 LLM call per call)
  {
    await resetOn();
    llmDelayMs = 100;
    const ids = [await insertMissed(K1, "3 minutes"), await insertMissed(K2, "2 minutes"), await insertMissed(K1, "1 minute")];
    const [a, b] = await Promise.all([tickJson(), tickJson()]);
    assert.equal(llmCalls, 3, "exactly one LLM call per call");
    assert.equal(a.capture.claimed + b.capture.claimed, 3);
    assert.equal(a.capture.written + b.capture.written, 3);
    for (const id of ids) assert.equal((await byId(id)).source, "conversation");
  }
  console.log("ok: double tick (concurrent) captures each call once (3 calls → 3 LLM calls)");

  // 5. after() and a tick overlapping capture once
  {
    await resetOn();
    llmDelayMs = 100;
    await post(K1, "connected");
    assert.equal(tasks.length, 1);
    const [, t] = await Promise.all([flush(), tickJson()]);
    assert.equal(llmCalls, 1, "after() and the tick: one LLM call");
    assert.equal(t.capture.written + (t.capture.claimed === 0 ? 1 : 0), 1);
    assert.equal((await extractedOf(K1))[0]!.extracted.source, "conversation");
    // and the other order: the tick first, then after()
    await resetOn();
    llmDelayMs = 100;
    await post(K2, "connected");
    const [t2] = await Promise.all([tickJson(), new Promise((r) => setTimeout(r, 20)).then(flush)]);
    assert.equal(llmCalls, 1, "tick first, after() second: one LLM call");
    assert.equal(t2.capture.claimed <= 1, true);
    assert.equal((await extractedOf(K2))[0]!.extracted.source, "conversation");
  }
  console.log("ok: after() + tick overlapping (both orders) capture once");

  // 6. abandoned claims are re-claimed; fresh ones and exhausted ones are not
  {
    await resetOn();
    const claim = (minAgo: number, attempt: number) => ({
      v: 1, pending: true, claimedAt: new Date(Date.now() - minAgo * 60_000).toISOString(), token: "mock-dead", attempt,
    });
    const stale = await insertMissed(K1, "30 minutes", claim(11, 1));
    const fresh = await insertMissed(K1, "30 minutes", claim(5, 1));
    const exhausted = await insertMissed(K2, "30 minutes", claim(60, CAPTURE_MAX_ATTEMPTS));
    const freshBefore = await byId(fresh);
    const exhaustedBefore = await byId(exhausted);
    llmReply = null; // first retry fails → attempt 2 kept
    let t = await tickJson();
    assert.deepEqual(t.capture, { claimed: 1, written: 0, skipped: 0, failed: 1 });
    const s1 = await byId(stale);
    assert.ok(isPendingClaim(s1));
    assert.equal(s1.attempt, 2, "re-claimed: attempt 2");
    assert.notEqual(s1.token, "mock-dead");
    assert.deepEqual(await byId(fresh), freshBefore, "a fresh claim is not re-claimed");
    assert.deepEqual(await byId(exhausted), exhaustedBefore, "an exhausted claim is never re-claimed");
    // the failed retry is itself fresh now: the next tick leaves it alone
    t = await tickJson();
    assert.equal(t.capture.claimed, 0);
    // once abandoned again, re-claimed and captured
    await exec(sql`UPDATE campaign_calls SET extracted = jsonb_set(extracted, '{claimedAt}', to_jsonb(${new Date(Date.now() - 11 * 60_000).toISOString()}::text)) WHERE id = ${stale}`);
    llmReply = GOOD;
    t = await tickJson();
    assert.deepEqual(t.capture, { claimed: 1, written: 1, skipped: 0, failed: 0 });
    assert.equal((await byId(stale)).source, "conversation");
    assert.equal(llmCalls, 2);
  }
  console.log(`ok: abandoned claim (> 10 min) re-claimed (attempt 2, then captured); fresh and exhausted (attempt ${CAPTURE_MAX_ATTEMPTS}) claims left alone`);

  // 7. cut-off (72 h) and per-tick bound (10, oldest first); outsideWindow counted
  {
    await resetOn();
    const old1 = await insertMissed(K1, "73 hours");
    const old2 = await insertMissed(K2, "100 days");
    const inside = await insertMissed(K1, "71 hours");
    const ids = [inside];
    for (let i = 0; i < 11; i++) ids.push(await insertMissed(i % 2 ? K1 : K2, `${60 - i} minutes`));
    const t1 = await tickJson();
    assert.deepEqual(t1.capture, { claimed: CAPTURE_CATCHUP_PER_TICK, written: CAPTURE_CATCHUP_PER_TICK, skipped: 0, failed: 0 });
    // oldest first: the 71 h call and the 9 next oldest
    for (const id of ids.slice(0, 10)) assert.equal((await byId(id)).source, "conversation");
    for (const id of ids.slice(10)) assert.deepEqual(await byId(id), {});
    const t2 = await tickJson();
    assert.equal(t2.capture.claimed, 2);
    assert.equal((await tickJson()).capture.claimed, 0);
    assert.deepEqual(await byId(old1), {}, "older than the cut-off: never picked");
    assert.deepEqual(await byId(old2), {});
    assert.equal(llmCalls, 12);
    const evs = await tickEvents();
    assert.deepEqual(evs.map((e) => e.metadata), [
      { picked: 10, outsideWindow: 2 },
      { picked: 2, outsideWindow: 2 },
      { picked: 0, outsideWindow: 2 },
    ], "the tick log counts calls outside the window, even when it picked nothing");
  }
  console.log(`ok: cut-off 72 h (older calls never picked, counted in outsideWindow), per-tick bound ${CAPTURE_CATCHUP_PER_TICK}, oldest first`);

  // 8. claimed but not capturable (blank transcript text): parked, never picked again, no LLM call
  {
    await resetOn();
    const id = ((await exec(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, outcome, transcript)
      VALUES (${C}, ${K1}, ${U}, 'connected', '[{"role":"user","text":"  "}]'::jsonb) RETURNING id`)) as unknown as Array<{ id: string }>)[0]!.id;
    assert.deepEqual((await tickJson()).capture, { claimed: 1, written: 0, skipped: 1, failed: 0 });
    const ex = await byId(id);
    assert.ok(isPendingClaim(ex));
    assert.equal(ex.attempt, CAPTURE_MAX_ATTEMPTS);
    assert.equal(capturedView(ex), null);
    await exec(sql`UPDATE campaign_calls SET extracted = jsonb_set(extracted, '{claimedAt}', '"2000-01-01T00:00:00.000Z"') WHERE id = ${id}`);
    assert.equal((await tickJson()).capture.claimed, 0, "parked: never picked again");
    assert.equal(llmCalls, 0);
  }
  console.log("ok: a claimed call that is not capturable is parked (exhausted), no LLM call, never re-picked");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
