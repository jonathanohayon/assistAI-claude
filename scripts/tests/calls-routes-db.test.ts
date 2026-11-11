// Tenant Calls page against a real Postgres (lib/calls/query.ts): the join
// trap, outbound exclusion, scope, figures and keyset pagination. Mock data
// only (+1555 numbers, example.com).
// Run with:  npx tsx scripts/tests/calls-routes-db.test.ts
// Runs only when CALLS_ROUTES_TEST_DB_URL points at a THROWAWAY, migrated
// database (it inserts rows and truncates the tables it uses); otherwise it is
// skipped, so plain `npm test` never touches a database.

import assert from "node:assert/strict";

const url = process.env.CALLS_ROUTES_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED calls-routes-db (set CALLS_ROUTES_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
process.env.DATABASE_URL = url;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { resolveScopeUserId } = await import("../../lib/admin-impersonate");
  const { getCallDetail, listCalls } = await import("../../lib/calls/query");
  const { decodeCursor, hashCallId, parsePeriod } = await import("../../lib/calls/core");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`); // cascades to calls, client_visits, agent_configs

  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const C = "00000000-0000-4000-8000-00000000000c";
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  for (const [id, email, role] of [
    [A, "tenant-a@example.com", "user"],
    [B, "tenant-b@example.com", "user"],
    [C, "tenant-c@example.com", "user"],
    [ADMIN, "admin@example.com", "admin"],
  ]) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${id}, ${email}, 'x', ${role})`);
  }
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, primary_language)
                 VALUES (${A}, '', '', 'he')`);

  const T = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, 0) + min * 60_000).toISOString();
  const addCall = async (o: {
    id: string;
    user: string;
    callId: string;
    endMin: number;
    dur?: number;
    from?: string;
    summary?: string;
    transcript?: unknown;
  }) =>
    exec(sql`INSERT INTO calls (id, user_id, from_number, transcript, summary, duration_seconds, call_id, created_at)
      VALUES (${o.id}, ${o.user}, ${o.from ?? "+15550000001"}, ${JSON.stringify(o.transcript ?? [{ role: "user", text: "Bonjour" }])}::jsonb,
              ${o.summary ?? ""}, ${o.dur ?? 60}, ${o.callId}, ${T(o.endMin)})`);
  const addEvent = async (user: string | null, event: string, min: number, metadata: Record<string, unknown>) =>
    exec(sql`INSERT INTO events (user_id, source, event, message, metadata, created_at)
      VALUES (${user}, 'agent', ${event}, 'mock', ${JSON.stringify(metadata)}::jsonb, ${T(min)})`);

  const ROOM = "call-_+15550000001_aaa";
  const HASH = hashCallId("call-_+15550000002_bbb");
  const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  // 1. raw room name (worker < 2026-11-05)
  await addCall({ id: id(1), user: A, callId: ROOM, endMin: 0, summary: "RDV pris" });
  await addEvent(A, "book_success", -0.5, { callId: ROOM, date: "2026-11-03", time: "10:00", name: "Mock", phone: "+15550000001" });
  await addEvent(A, "call_received", 0.01, { callId: id(1), toNumber: "+15550009999" });
  await addEvent(A, "whatsapp_sent_client", 0.1, { callId: id(1), sid: "SM-mock-1" });
  // 2. hashed id (current worker), call_started of an inbound SIP call
  await addCall({ id: id(2), user: A, callId: HASH, endMin: 10, from: "+15550000002" });
  await addEvent(A, "call_started", 9, { callId: HASH, roomName: "call-_+15550000002_bbb", origin: { kind: "sip" } });
  await addEvent(A, "call_transfer", 9.5, { callId: HASH, ok: true });
  // 3. legacy '' row: unstamped tool event in its time span
  await addCall({ id: id(3), user: A, callId: "", endMin: 20, dur: 120 });
  await addEvent(A, "cancel_success", 19, {});
  await addEvent(A, "book_success", 19.2, { callId: "another-call-xyz" }); // another call's event, same window
  // 4. legacy '' row, booking words in the summary, no event, duration 0
  await addCall({ id: id(4), user: A, callId: "", endMin: 30, dur: 0, summary: "La cliente veut un rendez-vous", from: "+15550000004" });
  // Tenant B: a call in the same windows, and events stamped with A's ids
  await addCall({ id: id(20), user: B, callId: "", endMin: 20, dur: 120 });
  await addEvent(B, "book_success", 19.5, {}); // B's unstamped booking in A's legacy window
  await addEvent(B, "reschedule_success", -0.4, { callId: ROOM }); // B's event, A's raw id
  await addEvent(B, "call_transfer", 9.6, { callId: HASH, ok: true }); // B's event, A's hashed id

  // Outbound / test calls of A (never listed, never counted):
  // 5. web LiveTest, hashed id: call_started says origin web / livetest- room
  const WEB = hashCallId(`livetest-${A}-mock`);
  await addCall({ id: id(5), user: A, callId: WEB, endMin: 40, from: "" });
  await addEvent(A, "call_started", 39, { callId: WEB, roomName: `livetest-${A}-mock`, origin: { kind: "web", userId: A } });
  await addEvent(A, "book_success", 39.5, { callId: WEB });
  // 6. call-me, raw room name
  await addCall({ id: id(6), user: A, callId: `callme__${A}__mock`, endMin: 50 });
  await addEvent(A, "book_success", 49.5, { callId: `callme__${A}__mock` });
  // 7. call-me, hashed id (worker main sees it as SIP; the room name gives it away)
  const CM = hashCallId(`callme__${A}__mock2`);
  await addCall({ id: id(7), user: A, callId: CM, endMin: 60 });
  await addEvent(A, "call_started", 59, { callId: CM, roomName: `callme__${A}__mock2`, origin: { kind: "sip" } });
  await addEvent(A, "call_transfer", 59.5, { callId: CM, ok: true });
  // 8. legacy '' web session: call_received without a dialled line
  await addCall({ id: id(8), user: A, callId: "", endMin: 70 });
  await addEvent(A, "call_received", 70.01, { callId: id(8), toNumber: "" });
  await addEvent(A, "book_success", 69.5, {});
  // 10. raw call id whose call_started is stamped with its HASH (checks the SQL sha256 = the worker's)
  const RAW10 = "call-_+15550000010_kkk";
  await addCall({ id: id(10), user: A, callId: RAW10, endMin: 90 });
  await addEvent(A, "call_started", 89, { callId: hashCallId(RAW10), roomName: "", origin: { kind: "web", userId: A } });
  // 9. campaign room (old row)
  await addCall({ id: id(9), user: A, callId: "campaign__c1__k1__1", endMin: 80 });

  // Contact name from client_visits (this tenant only)
  await exec(sql`INSERT INTO client_visits (user_id, event_id, client_phone, client_name, starts_at)
                 VALUES (${A}, 'mock-ev-1', '+15550000002', 'Mock Client', ${T(-1000)}),
                        (${B}, 'mock-ev-2', '+15550000004', 'Other Tenant Name', ${T(-1000)})`);

  const period = parsePeriod(T(-60), T(24 * 60))!;

  // ── List + figures ──
  const res = await listCalls({ userId: A, period, limit: 50, cursor: null });
  assert.deepEqual(res.items.map((i) => i.id), [id(4), id(3), id(2), id(1)], "inbound only, newest first");
  const by = Object.fromEntries(res.items.map((i) => [i.id, i]));
  assert.equal(by[id(1)].outcome, "booked", "raw room name joined");
  assert.equal(by[id(2)].outcome, "transferred", "hashed id joined");
  assert.equal(by[id(3)].outcome, "cancelled", "'' row joined by time window");
  assert.equal(by[id(4)].outcome, "conversation", "no keyword guess");
  assert.equal(by[id(4)].durationSeconds, null, "duration 0 → null");
  assert.equal(by[id(2)].contactName, "Mock Client");
  assert.equal(by[id(4)].contactName, null, "another tenant's contact name never used");
  assert.deepEqual(res.figures, { callsReceived: 4, booked: 1, transferred: 1 }, "tool-proven, inbound only");
  assert.deepEqual(res.period, { since: period.since.toISOString(), until: period.until.toISOString() });
  assert.equal(res.accountLanguage, "he");
  assert.equal(res.nextCursor, null);

  const one = await listCalls({ userId: A, period, limit: 1, cursor: null });
  assert.deepEqual(one.figures, res.figures, "figures cover the period, not the page");
  assert.ok(one.nextCursor);

  // B sees only its own call, and none of the events stamped with A's ids
  const resB = await listCalls({ userId: B, period, limit: 50, cursor: null });
  assert.deepEqual(resB.items.map((i) => i.id), [id(20)]);
  assert.equal(resB.items[0].outcome, "booked");
  assert.equal((await listCalls({ userId: C, period, limit: 50, cursor: null })).items.length, 0);
  assert.equal((await listCalls({ userId: B, period, limit: 50, cursor: null })).accountLanguage, "fr", "default language");

  // ── Detail + scope ──
  const d1 = await getCallDetail(A, id(1));
  assert.ok(d1);
  assert.equal(d1.summary, "RDV pris");
  assert.deepEqual(d1.transcript, [{ role: "caller", text: "Bonjour" }]);
  assert.equal(d1.transcriptRaw, null);
  assert.deepEqual(
    d1.actions.map((a) => a.kind),
    ["booked", "whatsapp_recap"],
    "tool event (raw id) + post-call event (uuid); B's event with A's id not attached",
  );
  assert.ok(!JSON.stringify(d1).includes("SM-mock"), "no internal ids");
  assert.ok(!JSON.stringify(d1).includes(ROOM), "no room name");
  const d3 = await getCallDetail(A, id(3));
  assert.deepEqual(d3!.actions.map((a) => a.kind), ["cancelled"], "window: no other call's / tenant's event");
  assert.equal(d3!.summary, null);
  assert.equal(await getCallDetail(A, id(20)), null, "tenant A cannot read B's call");
  assert.equal(await getCallDetail(B, id(1)), null, "tenant B cannot read A's call");
  for (const n of [5, 6, 7, 8, 9, 10]) assert.equal(await getCallDetail(A, id(n)), null, `outbound/test call ${n} → 404`);
  assert.ok(await getCallDetail(B, id(20)));

  assert.deepEqual(await resolveScopeUserId({ sessionUserId: ADMIN, asUserId: A }), { userId: A }, "admin asUserId");
  assert.deepEqual(await resolveScopeUserId({ sessionUserId: B, asUserId: A }), { forbidden: true }, "non-admin asUserId");
  assert.deepEqual(await resolveScopeUserId({ sessionUserId: A, asUserId: null }), { userId: A });

  // Unreadable transcript shape
  await addCall({ id: id(30), user: C, callId: "", endMin: 100, transcript: { odd: true } });
  const dOdd = await getCallDetail(C, id(30));
  assert.deepEqual(dOdd!.transcript, []);
  assert.equal(dOdd!.transcriptRaw, '{"odd":true}');

  // ── Pagination: keyset stability ──
  // 7 calls of C sharing the SAME microsecond timestamp + 3 others.
  const same = "2026-11-02T08:00:00.123456Z";
  const pageIds: string[] = [];
  for (let k = 0; k < 7; k++) {
    const cid = `20000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
    pageIds.push(cid);
    await exec(sql`INSERT INTO calls (id, user_id, call_id, created_at) VALUES (${cid}, ${C}, '', ${same})`);
  }
  for (let k = 0; k < 3; k++) {
    await exec(sql`INSERT INTO calls (id, user_id, call_id, created_at)
                   VALUES (${`20000000-0000-4000-8000-${String(100 + k).padStart(12, "0")}`}, ${C}, '', ${T(2000 + k)})`);
  }
  const cPeriod = parsePeriod("2026-11-01T00:00:00Z", "2026-11-05T00:00:00Z")!;
  const full = (await listCalls({ userId: C, period: cPeriod, limit: 100, cursor: null })).items.map((i) => i.id);
  assert.equal(full.length, 11);
  const seen: string[] = [];
  let cursor: ReturnType<typeof decodeCursor> = null;
  let pages = 0;
  for (;;) {
    const p = await listCalls({ userId: C, period: cPeriod, limit: 3, cursor });
    seen.push(...p.items.map((i) => i.id));
    pages++;
    assert.equal(p.figures.callsReceived, pages === 1 ? 11 : 12, "figures over the period, not the page");
    if (pages === 1) {
      // A newer call arriving between pages must not shift the next pages.
      await exec(sql`INSERT INTO calls (id, user_id, call_id, created_at)
                     VALUES ('20000000-0000-4000-8000-000000000999', ${C}, '', '2026-11-04T23:00:00Z')`);
    }
    if (!p.nextCursor) break;
    cursor = decodeCursor(p.nextCursor);
    assert.ok(cursor);
    assert.deepEqual(cursor.period, cPeriod, "the cursor carries the period");
  }
  assert.deepEqual(seen, full, "pages = the full list, no duplicate, no gap, same order");
  assert.equal(pages, 4);
  assert.deepEqual(
    seen.filter((x) => pageIds.includes(x)),
    [...pageIds].sort().reverse(),
    "same timestamp: id desc",
  );

  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`); // cascades to calls, client_visits, agent_configs
  console.log("ALL CALLS-ROUTES DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
