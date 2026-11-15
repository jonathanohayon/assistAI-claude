// Verified numbers N1 against a real Postgres (the "0051 writes no data"
// md5 proof runs before this, in scripts/contact-confirmation-db.sh):
//   1. the column, and every EXISTING value (no record) reads CONFIRMED and
//      grandfathered; the enforcement date setting is absent;
//   2. the write paths with the real DB: the email save, the Tools write
//      (switch park / restore), the config routes' column write (re-saved
//      grandfathered value → no record, new value → unconfirmed, same →
//      kept, '' → cleared, omitted → kept), the record stored as a jsonb OBJECT;
//   3. the admin confirm (by "admin", logged without the value);
//   4. sends identical whatever the record holds: /api/calls/end (owner
//      recap WhatsApp + email, senders INJECTED), the WhatsApp test (sender
//      injected), the owner digest run: the same calls, payloads and
//      responses with no record, a grandfathered one, and every unconfirmed
//      variant.
// Mock data only (+1555 numbers, example.com); every outbound fetch is
// mocked (the summary) or refused. Run with:
//   npm run test:db -- --only contact-confirmation   (see scripts/contact-confirmation-db.sh)
// Runs only when CONTACT_CONFIRMATION_TEST_DB_URL points at a THROWAWAY,
// migrated database (it deletes users/events); otherwise it is skipped.

import assert from "node:assert/strict";

const url = process.env.CONTACT_CONFIRMATION_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED contact-confirmation-db (set CONTACT_CONFIRMATION_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) {
  if (/^(RESEND|TWILIO|WHATSAPP|GOOGLE|LIVEKIT|SMTP|EMAIL)_/.test(k)) delete process.env[k];
}
process.env.INTERNAL_SECRET = "mock-internal-secret";
process.env.OPENAI_API_KEY = "mock-key";
delete process.env.REALTIME_API_KEY;

const SUMMARY = {
  summary: "Mock summary: Dana booked a haircut.",
  for_client: "Thanks Dana, see you Tuesday.",
  for_owner: "Name: Dana\nReason: haircut\nBooking: Tuesday 10:00",
};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u === "https://api.openai.com/v1/chat/completions") {
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(SUMMARY) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`network refused in test: ${u}`);
}) as typeof fetch;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const cc = await import("../../lib/contact-confirmation");
  const { contactConfirmationsWrite, loadEnforcementStartedAt, markContactConfirmedByAdmin } = await import("../../lib/contact-confirmation-store");
  const { saveOwnerRecapEmail } = await import("../../lib/owner-recap-email-store");
  const { writeTools } = await import("../../lib/tools/write");
  const { ownerRecapEmailDeps } = await import("../../lib/owner-recap-email-send");
  const { ownerRecapWhatsAppDeps } = await import("../../lib/owner-recap-whatsapp");
  const { runWhatsAppTest } = await import("../../lib/notifications/whatsapp-test");
  const { whatsAppTestDeps } = await import("../../lib/notifications/whatsapp-test-deps");
  const { runOwnerDigests } = await import("../../lib/owner-digest-run");
  const callsEnd = await import("../../app/api/calls/end/route");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];
  const record = async (u: string) =>
    (await rows<{ c: unknown; t: string }>(sql`SELECT contact_confirmations AS c, jsonb_typeof(contact_confirmations) AS t FROM agent_configs WHERE user_id = ${u}`))[0];
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`); // cascades to calls, agent_configs

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ADMIN = id(900);
  const A = { all: id(1), parked: id(2), none: id(3) };
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  for (const [k, u] of Object.entries(A)) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (${u}, ${`${k}@example.com`}, 'x', 'user', 'Demo Salon')`);
    // An existing account: inserted without the column → its default.
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, primary_language, business) VALUES (${u}, '', '', 'en', ${JSON.stringify({ identity: { name: "Demo Salon" } })}::jsonb)`);
  }
  await exec(sql`UPDATE agent_configs SET owner_whatsapp = '+15550100001', transfer_number = '+15550100002', owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true WHERE user_id = ${A.all}`);
  await exec(sql`UPDATE agent_configs SET owner_whatsapp = '+15550100011', transfer_number = '', transfer_number_parked = '+15550100012' WHERE user_id = ${A.parked}`);

  // ── 1. Existing values read confirmed (grandfathered) ─────────────────
  const col = await rows<{ column_default: string; is_nullable: string; data_type: string }>(sql`
    SELECT column_default, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name = 'contact_confirmations'`);
  assert.deepEqual(col.map((c) => [c.data_type, c.column_default, c.is_nullable]), [["jsonb", "'{}'::jsonb", "NO"]]);
  for (const u of Object.values(A)) assert.deepEqual(await record(u), { c: {}, t: "object" }, "existing account: '{}'");
  const GF = { allowed: true, grace: "grandfathered", state: "confirmed", source: "grandfathered" };
  const all = (await record(A.all)).c;
  for (const [kind, v] of [["owner_whatsapp", "+15550100001"], ["transfer_number", "+15550100002"], ["owner_recap_email", "owner@example.com"]] as const) {
    assert.deepEqual(cc.maySendTo(kind, v, all), GF, `${kind}: no record → confirmed, grandfathered, allowed`);
  }
  assert.deepEqual(cc.maySendTo("transfer_number", "+15550100012", (await record(A.parked)).c), GF, "parked transfer: grandfathered");
  assert.equal(await loadEnforcementStartedAt(), null, "N1: no enforcement date");
  assert.equal((await rows(sql`SELECT 1 FROM app_settings WHERE key = 'contact_confirmation_enforced_at'`)).length, 0);

  // ── 2. Write paths ────────────────────────────────────────────────────
  // 2a. The config routes' column write (dashboard + admin PUT call
  // contactConfirmationsWrite(<row before>, updates) and set it with updates).
  const routeSave = async (u: string, updates: Record<string, unknown>) => {
    const [cur] = await rows<{ ownerWhatsapp: string; transferNumber: string; transferNumberParked: string | null; ownerRecapEmail: string; contactConfirmations: unknown }>(sql`
      SELECT owner_whatsapp AS "ownerWhatsapp", transfer_number AS "transferNumber", transfer_number_parked AS "transferNumberParked",
             owner_recap_email AS "ownerRecapEmail", contact_confirmations AS "contactConfirmations"
      FROM agent_configs WHERE user_id = ${u}`);
    const w = contactConfirmationsWrite(cur, updates);
    const set: Record<string, unknown> = { ...updates, ...w };
    if (Object.keys(set).length === 0) return w;
    const { agentConfigs } = await import("../../lib/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(agentConfigs).set(set as never).where(eq(agentConfigs.userId, u));
    return w;
  };
  const U = id(10);
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${U}, 'u@example.com', 'x', 'user')`);
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_whatsapp, transfer_number) VALUES (${U}, '', '', '+15550100101', '+15550100102')`);

  assert.deepEqual(await routeSave(U, { instructions: "x" }), {}, "a save of other fields writes no record");
  assert.deepEqual(await routeSave(U, { ownerWhatsapp: "+15550100101", transferNumber: "+15550100102" }), {}, "the form re-sending grandfathered values → no record");
  assert.deepEqual((await record(U)).c, {}, "still grandfathered");
  await routeSave(U, { ownerWhatsapp: "+15550100109" });
  const r1 = await record(U);
  assert.equal(r1.t, "object", "stored as a jsonb object, not a string");
  const nw = (r1.c as Record<string, { value: string; state: string; at: string }>).owner_whatsapp;
  assert.deepEqual([nw.value, nw.state], ["+15550100109", "unconfirmed"], "new value → unconfirmed for it");
  assert.ok(!("transfer_number" in (r1.c as object)), "other kinds untouched (still grandfathered)");
  assert.equal(cc.maySendTo("owner_whatsapp", "+15550100109", r1.c).state, "unconfirmed");
  assert.equal(cc.maySendTo("owner_whatsapp", "+15550100109", r1.c).allowed, true, "enforcement off: still allowed");
  assert.deepEqual(await routeSave(U, { ownerWhatsapp: "+1 555 010 0109" }), {}, "same value → kept");
  assert.deepEqual(await routeSave(U, { instructions: "y" }), {}, "omitted → kept");
  assert.deepEqual((await record(U)).c, r1.c);
  // The legacy transfer write while the switch is OFF: '' keeps the parked number.
  await exec(sql`UPDATE agent_configs SET transfer_number = '', transfer_number_parked = '+15550100102' WHERE user_id = ${U}`);
  assert.deepEqual(await routeSave(U, { transferNumber: "" }), {}, "'' while parked → no write");
  await routeSave(U, { ownerWhatsapp: "" });
  assert.deepEqual((await record(U)).c, {}, "'' → cleared");

  // 2b. The email save (the notifications route's own store function).
  const SENDER = { senderConfigured: true };
  const E = A.all;
  await saveOwnerRecapEmail(E, { ownerRecapEmailEnabled: false }, SENDER);
  assert.deepEqual((await record(E)).c, {}, "switch only (address omitted) → no record");
  await saveOwnerRecapEmail(E, { ownerRecapEmail: " OWNER@example.com " }, SENDER);
  assert.deepEqual((await record(E)).c, {}, "same address re-saved → still grandfathered");
  const saved = await saveOwnerRecapEmail(E, { ownerRecapEmail: "new@example.com" }, SENDER);
  assert.deepEqual(saved.body, { ownerRecapEmail: "new@example.com", ownerRecapEmailEnabled: false, changedFields: ["ownerRecapEmail"] }, "route body unchanged: no record in it");
  const e1 = (await record(E)).c as Record<string, { value: string; state: string }>;
  assert.deepEqual(Object.keys(e1), ["owner_recap_email"]);
  assert.deepEqual([e1.owner_recap_email.value, e1.owner_recap_email.state], ["new@example.com", "unconfirmed"]);
  await saveOwnerRecapEmail(E, { ownerRecapEmail: "" }, SENDER);
  assert.deepEqual((await record(E)).c, {}, "'' → cleared");
  await exec(sql`UPDATE agent_configs SET owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true, contact_confirmations = '{}'::jsonb WHERE user_id = ${E}`);

  // 2c. Tools switch OFF then ON: the number is parked then restored; same
  // kept number → no record (still grandfathered), and a confirmed one is kept.
  const P = A.all;
  for (const start of [{}, { transfer_number: { value: "+15550100002", state: "confirmed", at: "2026-11-15T00:00:00.000Z", by: "admin" } }]) {
    await exec(sql`UPDATE agent_configs SET contact_confirmations = ${JSON.stringify(start)}::jsonb WHERE user_id = ${P}`);
    assert.deepEqual(await writeTools(P, null, { transfer: { enabled: false } }), { ok: true });
    const [off] = await rows<{ t: string; p: string | null }>(sql`SELECT transfer_number AS t, transfer_number_parked AS p FROM agent_configs WHERE user_id = ${P}`);
    assert.deepEqual(off, { t: "", p: "+15550100002" });
    assert.deepEqual((await record(P)).c, start, "switch OFF keeps the record");
    assert.deepEqual(await writeTools(P, null, { transfer: { enabled: true } }), { ok: true });
    assert.deepEqual((await record(P)).c, start, "switch ON keeps the record");
  }
  await exec(sql`UPDATE agent_configs SET contact_confirmations = '{}'::jsonb WHERE user_id = ${P}`);

  // ── 3. Admin confirm ──────────────────────────────────────────────────
  await routeSave(U, { ownerWhatsapp: "+15550100109" });
  assert.deepEqual(await markContactConfirmedByAdmin(U, "owner_whatsapp", ADMIN), { ok: true });
  const ad = ((await record(U)).c as Record<string, { value: string; state: string; by: string }>).owner_whatsapp;
  assert.deepEqual([ad.value, ad.state, ad.by], ["+15550100109", "confirmed", "admin"]);
  assert.equal(cc.maySendTo("owner_whatsapp", "+15550100109", (await record(U)).c, { enforced: true }).allowed, true);
  const ev = await rows<{ user_id: string; metadata: Record<string, unknown>; message: string }>(sql`SELECT user_id, metadata, message FROM events WHERE event = 'contact_confirmed_by_admin'`);
  assert.equal(ev.length, 1, "logged");
  assert.deepEqual(ev[0].metadata, { targetUserId: U, kind: "owner_whatsapp", by: "admin" });
  assert.ok(!JSON.stringify(ev[0]).includes("15550100109"), "the value is never logged");
  assert.deepEqual(await markContactConfirmedByAdmin(U, "owner_recap_email", ADMIN), { ok: false, error: "no_value" });
  assert.deepEqual(await markContactConfirmedByAdmin(id(999), "owner_whatsapp", ADMIN), { ok: false, error: "no_config" });
  // A later change of that value → unconfirmed again.
  await routeSave(U, { ownerWhatsapp: "+15550100108" });
  assert.equal(cc.contactState("owner_whatsapp", "+15550100108", (await record(U)).c).state, "unconfirmed");
  const at = "2026-11-15T00:00:00.000Z";

  // ── 4. Sends identical whatever the record holds ──────────────────────
  const S = A.all; // owner WhatsApp + transfer + recap email ON
  const VARIANTS: Array<[string, unknown]> = [
    ["no record (grandfathered)", {}],
    ["confirmed by admin", { owner_whatsapp: { value: "+15550100001", state: "confirmed", at, by: "admin" }, transfer_number: { value: "+15550100002", state: "confirmed", at, by: "admin" } }],
    ["saved unconfirmed", { owner_whatsapp: { value: "+15550100001", state: "unconfirmed", at }, owner_recap_email: { value: "owner@example.com", state: "unconfirmed", at }, transfer_number: { value: "+15550100002", state: "unconfirmed", at } }],
    ["value changed", { owner_whatsapp: { value: "+15550199999", state: "confirmed", at, by: "code" }, owner_recap_email: { value: "old@example.com", state: "confirmed", at, by: "code" } }],
    ["malformed", { owner_whatsapp: "yes", owner_recap_email: [1] }],
  ];
  type Capture = { wa: unknown[]; email: unknown[]; waTest: unknown[]; responses: unknown[] };
  const waSends: unknown[] = [];
  const emailSends: unknown[] = [];
  ownerRecapWhatsAppDeps.send = async (o) => {
    waSends.push(o);
    return { ok: true, sid: "SM-mock" } as never;
  };
  ownerRecapEmailDeps.senderConfigured = () => true;
  ownerRecapEmailDeps.send = async (...a) => {
    emailSends.push(a);
    return { ok: true, id: "mock-email" };
  };
  const waTestSends: unknown[] = [];
  const waTestDeps = {
    ...whatsAppTestDeps,
    consumeRateLimit: async () => ({ ok: true }) as never,
    isConfigured: () => true,
    templateSid: () => undefined,
    send: async (o: unknown) => {
      waTestSends.push(o);
      return { ok: true, sid: "SM-mock" } as never;
    },
    logFailure: () => undefined,
  };
  const transcript = [
    { role: "assistant", text: "Hello, Demo Salon." },
    { role: "user", text: "I'd like a haircut on Tuesday." },
    { role: "assistant", text: "Booked for Tuesday 10:00." },
  ];
  const captures: Array<[string, Capture]> = [];
  for (const [name, rec] of VARIANTS) {
    await exec(sql`UPDATE agent_configs SET contact_confirmations = ${JSON.stringify(rec)}::jsonb WHERE user_id = ${S}`);
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM calls`);
    waSends.length = 0;
    emailSends.length = 0;
    waTestSends.length = 0;
    const res = await callsEnd.POST(
      new NextRequest("http://localhost/api/calls/end", {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": "mock-internal-secret" },
        body: JSON.stringify({ userId: S, fromNumber: "+15550100090", toNumber: "", transcript, durationSeconds: 60, callId: "call-mock-1" }),
      }),
    );
    const text = await res.text();
    const callId = (JSON.parse(text) as { callId?: string }).callId ?? "";
    await new Promise((r) => setTimeout(r, 400)); // the email is fire-and-forget
    const waTest = await runWhatsAppTest({ userId: S, displayName: "Dana", body: {} }, waTestDeps as never);
    // The digest, run "tomorrow": yesterday = the call just ended; no WhatsApp
    // provider configured → the same outcome for every record.
    await exec(sql`DELETE FROM events`);
    const digestNow = new Date(Date.now() + 24 * 3600_000);
    const digest = await runOwnerDigests(digestNow);
    const digestEvents = await rows<{ event: string; level: string }>(sql`SELECT event, level FROM events WHERE user_id = ${S} ORDER BY event`);
    captures.push([
      name,
      {
        wa: [...waSends],
        email: [...emailSends],
        waTest: [...waTestSends],
        responses: [res.status, callId ? text.replaceAll(callId, "<id>") : text, waTest, digest, digestEvents],
      },
    ]);
  }
  const [[, ref]] = captures;
  assert.equal(ref.wa.length, 1, "the owner recap WhatsApp is sent");
  assert.equal(ref.email.length, 1, "the owner recap email is sent");
  assert.equal(ref.waTest.length, 1, "the WhatsApp test is sent");
  assert.equal(JSON.stringify(ref.wa).includes("+15550100001"), true);
  for (const [name, c] of captures.slice(1)) {
    assert.deepEqual(c, ref, `${name}: same sends, payloads and responses as with no record`);
  }

  console.log(`ALL CONTACT-CONFIRMATION DB TESTS PASSED (${captures.length} record variants, identical sends)`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
