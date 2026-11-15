// Verified numbers N1 against a real Postgres:
//   1. migration 0051: the column, every EXISTING value grandfathered (read
//      confirmed, by "grandfathered", one timestamp), a re-run is a no-op
//      (no row rewritten);
//   2. the write paths with the real DB: the email save, the Tools write
//      (switch park / restore), the config routes' column write (new value →
//      unconfirmed, same → kept, '' → cleared, omitted → kept), the record
//      stored as a jsonb OBJECT;
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
import { readFileSync } from "node:fs";
import path from "node:path";

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
  const { contactConfirmationsWrite, markContactConfirmedByAdmin } = await import("../../lib/contact-confirmation-store");
  const { saveOwnerRecapEmail } = await import("../../lib/owner-recap-email-store");
  const { writeTools } = await import("../../lib/tools/write");
  const { ownerRecapEmailDeps } = await import("../../lib/owner-recap-email-send");
  const { ownerRecapWhatsAppDeps } = await import("../../lib/owner-recap-whatsapp");
  const { runWhatsAppTest } = await import("../../lib/notifications/whatsapp-test");
  const { whatsAppTestDeps } = await import("../../lib/notifications/whatsapp-test-deps");
  const { runOwnerDigests } = await import("../../lib/owner-digest-run");
  const callsEnd = await import("../../app/api/calls/end/route");

  const root = path.resolve(new URL("../..", import.meta.url).pathname);
  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];
  const record = async (u: string) =>
    (await rows<{ c: unknown; t: string }>(sql`SELECT contact_confirmations AS c, jsonb_typeof(contact_confirmations) AS t FROM agent_configs WHERE user_id = ${u}`))[0];
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`); // cascades to calls, agent_configs

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ADMIN = id(900);
  const A = { all: id(1), parked: id(2), none: id(3), emailOnly: id(4), hasRecord: id(5) };
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  for (const [k, u] of Object.entries(A)) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (${u}, ${`${k}@example.com`}, 'x', 'user', 'Demo Salon')`);
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, primary_language, business) VALUES (${u}, '', '', 'en', ${JSON.stringify({ identity: { name: "Demo Salon" } })}::jsonb)`);
  }
  await exec(sql`UPDATE agent_configs SET owner_whatsapp = '+15550100001', transfer_number = '+15550100002', owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true WHERE user_id = ${A.all}`);
  await exec(sql`UPDATE agent_configs SET owner_whatsapp = '+15550100011', transfer_number = '', transfer_number_parked = '+15550100012' WHERE user_id = ${A.parked}`);
  await exec(sql`UPDATE agent_configs SET owner_recap_email = 'only@example.com' WHERE user_id = ${A.emailOnly}`);
  await exec(sql`UPDATE agent_configs SET owner_whatsapp = '+15550100051' WHERE user_id = ${A.hasRecord}`);

  // ── 1. Migration 0051 ─────────────────────────────────────────────────
  const col = await rows<{ column_default: string; is_nullable: string; data_type: string }>(sql`
    SELECT column_default, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name = 'contact_confirmations'`);
  assert.deepEqual(col.map((c) => [c.data_type, c.column_default, c.is_nullable]), [["jsonb", "'{}'::jsonb", "NO"]]);
  // The rows above are "existing accounts": the column as the ALTER leaves
  // it. Drop it and run the migration file raw, as a deploy would on main's
  // data; one kind of one row already has a record, which must survive.
  await exec(sql`ALTER TABLE agent_configs DROP COLUMN contact_confirmations`);
  const stmts = readFileSync(path.join(root, "drizzle/0051_contact_confirmations.sql"), "utf8").split("--> statement-breakpoint");
  assert.equal(stmts.length, 2);
  await exec(sql.raw(stmts[0]));
  const earlier = { owner_whatsapp: { value: "+15550100059", state: "unconfirmed", at: "2026-11-10T00:00:00.000Z" } };
  await exec(sql`UPDATE agent_configs SET contact_confirmations = ${JSON.stringify(earlier)}::jsonb WHERE user_id = ${A.hasRecord}`);
  const t0 = Date.now();
  await exec(sql.raw(stmts[1]));

  const all = (await record(A.all)).c as Record<string, { at: string }>;
  const at = all.owner_whatsapp.at;
  assert.match(at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "ISO timestamp");
  assert.ok(Math.abs(Date.parse(at) - t0) < 60_000, "the migration's time");
  const g = (value: string) => ({ value, state: "confirmed", at, by: "grandfathered" });
  assert.deepEqual(all, { owner_whatsapp: g("+15550100001"), transfer_number: g("+15550100002"), owner_recap_email: g("owner@example.com") });
  assert.deepEqual((await record(A.parked)).c, { owner_whatsapp: g("+15550100011"), transfer_number: g("+15550100012") }, "parked = the kept transfer number");
  assert.deepEqual((await record(A.none)).c, {}, "no value → no record");
  assert.deepEqual((await record(A.emailOnly)).c, { owner_recap_email: g("only@example.com") });
  assert.deepEqual((await record(A.hasRecord)).c, earlier, "an existing record is never overwritten");
  // Read: every existing value CONFIRMED, identifiable as grandfathered.
  for (const [kind, v] of [["owner_whatsapp", "+15550100001"], ["transfer_number", "+15550100002"], ["owner_recap_email", "owner@example.com"]] as const) {
    assert.deepEqual(cc.maySendTo(kind, v, all), { allowed: true, state: "confirmed", by: "grandfathered", at });
  }
  assert.deepEqual(cc.maySendTo("transfer_number", "+15550100012", (await record(A.parked)).c), { allowed: true, state: "confirmed", by: "grandfathered", at });
  // Re-run: a no-op (no row rewritten: xmin unchanged).
  const xmin = async () => rows<{ u: string; x: string; c: unknown }>(sql`SELECT user_id AS u, xmin::text AS x, contact_confirmations AS c FROM agent_configs ORDER BY user_id`);
  const before = await xmin();
  for (const s of stmts) await exec(sql.raw(s));
  assert.deepEqual(await xmin(), before, "re-run of 0051 rewrites nothing");

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
  await exec(sql.raw(stmts[1])); // grandfather this account too
  const gU = (await record(U)).c as Record<string, { at: string }>;
  assert.equal((gU.owner_whatsapp as unknown as { by: string }).by, "grandfathered");

  assert.deepEqual(await routeSave(U, { instructions: "x" }), {}, "a save of other fields writes no record");
  assert.deepEqual((await record(U)).c, gU, "omitted → kept");
  assert.deepEqual(await routeSave(U, { ownerWhatsapp: "+15550100101" }), {}, "same value → no write");
  assert.deepEqual((await record(U)).c, gU, "same value → kept");
  await routeSave(U, { ownerWhatsapp: "+15550100109" });
  const r1 = await record(U);
  assert.equal(r1.t, "object", "stored as a jsonb object, not a string");
  const nw = (r1.c as Record<string, { value: string; state: string; at: string }>).owner_whatsapp;
  assert.deepEqual([nw.value, nw.state], ["+15550100109", "unconfirmed"], "new value → unconfirmed for it");
  assert.deepEqual((r1.c as Record<string, unknown>).transfer_number, gU.transfer_number, "other kinds untouched");
  assert.equal(cc.contactState("owner_whatsapp", "+15550100109", r1.c).state, "unconfirmed");
  // The legacy transfer write while the switch is OFF: '' keeps the parked number.
  await exec(sql`UPDATE agent_configs SET transfer_number = '', transfer_number_parked = '+15550100102' WHERE user_id = ${U}`);
  assert.deepEqual(await routeSave(U, { transferNumber: "" }), {}, "'' while parked keeps the kept number's record");
  await routeSave(U, { transferNumber: "", transferNumberParked: null });
  assert.ok(!("transfer_number" in ((await record(U)).c as object)), "no number left → cleared");
  await routeSave(U, { ownerWhatsapp: "" });
  assert.deepEqual((await record(U)).c, {}, "'' → cleared");

  // 2b. The email save (the notifications route's own store function).
  const SENDER = { senderConfigured: true };
  const E = A.all;
  const gE = (await record(E)).c as Record<string, unknown>;
  await saveOwnerRecapEmail(E, { ownerRecapEmailEnabled: false }, SENDER);
  assert.deepEqual((await record(E)).c, gE, "switch only (address omitted) → kept");
  await saveOwnerRecapEmail(E, { ownerRecapEmail: " OWNER@example.com " }, SENDER);
  assert.deepEqual((await record(E)).c, gE, "same address → kept");
  const saved = await saveOwnerRecapEmail(E, { ownerRecapEmail: "new@example.com" }, SENDER);
  assert.deepEqual(saved.body, { ownerRecapEmail: "new@example.com", ownerRecapEmailEnabled: false, changedFields: ["ownerRecapEmail"] }, "route body unchanged: no record in it");
  const e1 = (await record(E)).c as Record<string, { value: string; state: string }>;
  assert.deepEqual([e1.owner_recap_email.value, e1.owner_recap_email.state], ["new@example.com", "unconfirmed"]);
  assert.deepEqual(e1.owner_whatsapp, gE.owner_whatsapp);
  await saveOwnerRecapEmail(E, { ownerRecapEmail: "" }, SENDER);
  assert.ok(!("owner_recap_email" in ((await record(E)).c as object)), "'' → cleared");
  await exec(sql`UPDATE agent_configs SET owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true, contact_confirmations = ${JSON.stringify(gE)}::jsonb WHERE user_id = ${E}`);

  // 2c. Tools switch OFF then ON: the number is parked then restored; same
  // kept number → the grandfathered record is kept.
  const P = A.all;
  const gP = (await record(P)).c;
  assert.deepEqual(await writeTools(P, null, { transfer: { enabled: false } }), { ok: true });
  const [off] = await rows<{ t: string; p: string | null }>(sql`SELECT transfer_number AS t, transfer_number_parked AS p FROM agent_configs WHERE user_id = ${P}`);
  assert.deepEqual(off, { t: "", p: "+15550100002" });
  assert.deepEqual((await record(P)).c, gP, "switch OFF keeps the record");
  assert.deepEqual(await writeTools(P, null, { transfer: { enabled: true } }), { ok: true });
  assert.deepEqual((await record(P)).c, gP, "switch ON keeps the record");

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

  // ── 4. Sends identical whatever the record holds ──────────────────────
  const S = A.all; // owner WhatsApp + transfer + recap email ON
  const VARIANTS: Array<[string, unknown]> = [
    ["no record", {}],
    ["grandfathered", gE],
    ["saved unconfirmed", { owner_whatsapp: { value: "+15550100001", state: "unconfirmed", at: at }, owner_recap_email: { value: "owner@example.com", state: "unconfirmed", at }, transfer_number: { value: "+15550100002", state: "unconfirmed", at } }],
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
