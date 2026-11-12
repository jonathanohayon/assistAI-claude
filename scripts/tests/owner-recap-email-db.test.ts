// Owner recap by email against a real Postgres: the migration (defaults OFF,
// idempotent), the save path the dashboard route calls (tenant + admin via
// ?asUserId, absent ≠ empty) and /api/calls/end itself, with the email sender
// INJECTED: 0 emails for accounts that did not switch it on, response bytes
// identical to origin/main's route for every account, one email when ON, and
// a sender failure that changes nothing but logs an event.
// Mock data only (+1555 numbers, example.com, "Demo Salon"); every outbound
// fetch is mocked (the summary) or refused.
// Run with:  OWNER_RECAP_EMAIL_TEST_DB_URL=postgres://… npx tsx scripts/tests/owner-recap-email-db.test.ts
// Runs only when OWNER_RECAP_EMAIL_TEST_DB_URL points at a THROWAWAY, migrated
// database (it deletes users/events); otherwise it is skipped, so plain
// `npm test` never touches a database. main's route is copied (git show
// OWNER_RECAP_EMAIL_MAIN_REF, default origin/main) into a git-ignored
// scripts/tests/.owner-recap-main-ref-* folder, removed on exit.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.env.OWNER_RECAP_EMAIL_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED owner-recap-email-db (set OWNER_RECAP_EMAIL_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
process.env.DATABASE_URL = url;
// Nothing may leave this process: no provider key, mock secrets only.
for (const k of Object.keys(process.env)) {
  if (/^(RESEND|TWILIO|WHATSAPP|GOOGLE|LIVEKIT)_/.test(k)) delete process.env[k];
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
  const { resolveScopeUserId } = await import("../../lib/admin-impersonate");
  const { loadOwnerRecapEmail, saveOwnerRecapEmail } = await import("../../lib/owner-recap-email-store");
  const { ownerRecapEmailDeps } = await import("../../lib/owner-recap-email-send");
  const mine = await import("../../app/api/calls/end/route");

  const root = path.resolve(new URL("../..", import.meta.url).pathname);
  const ref = process.env.OWNER_RECAP_EMAIL_MAIN_REF || "origin/main";
  const refDir = mkdtempSync(path.join(root, "scripts/tests/.owner-recap-main-ref-"));
  process.on("exit", () => rmSync(refDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(refDir, "route.ts"),
    execFileSync("git", ["show", `${ref}:app/api/calls/end/route.ts`], { cwd: root, encoding: "utf8" }).replaceAll('"@/', `"${root}/`),
  );
  const main = (await import(path.join(refDir, "route.ts"))) as typeof mine;
  assert.ok(!readFileSync(path.join(refDir, "route.ts"), "utf8").includes("owner-recap-email"), "the reference is the route before this change");

  // The sender, injected: counts, never sends.
  type SendArgs = Parameters<typeof ownerRecapEmailDeps.send>;
  const sends: SendArgs[] = [];
  let failNext = false;
  ownerRecapEmailDeps.send = async (...a) => {
    sends.push(a);
    if (failNext) throw new Error(`provider down for ${a[0]}`);
    return { ok: true, id: `mock-email-${sends.length}` };
  };

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`); // cascades to calls, agent_configs

  // ── 1. Migration: columns with defaults OFF / '', and idempotent ───────
  const cols = await rows<{ column_name: string; column_default: string; is_nullable: string }>(sql`
    SELECT column_name, column_default, is_nullable FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name IN ('owner_recap_email', 'owner_recap_email_enabled') ORDER BY column_name`);
  assert.deepEqual(
    cols.map((c) => [c.column_name, c.column_default, c.is_nullable]),
    [
      ["owner_recap_email", "''::text", "NO"],
      ["owner_recap_email_enabled", "false", "NO"],
    ],
  );
  for (const stmt of readFileSync(path.join(root, "drizzle/0050_owner_recap_email.sql"), "utf8").split("--> statement-breakpoint")) {
    await exec(sql.raw(stmt)); // re-run: ADD COLUMN IF NOT EXISTS → no error
  }

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ADMIN = id(900);
  const T = { existing: id(1), addressOff: id(2), onEmpty: id(3), on: id(4), failing: id(5), noName: id(6), store: id(7) };
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  for (const [k, u] of Object.entries(T)) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${u}, ${`${k}@example.com`}, 'x', 'user')`);
    // An existing account: inserted WITHOUT the new columns → the defaults.
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, primary_language, owner_whatsapp, business)
      VALUES (${u}, '', '', 'en', '+15550100009', ${JSON.stringify(k === "noName" ? {} : { identity: { name: "Demo Salon" } })}::jsonb)`);
  }
  assert.deepEqual(await loadOwnerRecapEmail(T.existing), { ownerRecapEmail: "", ownerRecapEmailEnabled: false }, "existing account: OFF, no address");

  // ── 2. Save path (the route's own body → stored helper) ───────────────
  const asTenant = await resolveScopeUserId({ sessionUserId: T.store, asUserId: null });
  const asAdmin = await resolveScopeUserId({ sessionUserId: ADMIN, asUserId: T.store });
  const forbidden = await resolveScopeUserId({ sessionUserId: T.existing, asUserId: T.store });
  assert.deepEqual(asTenant, { userId: T.store });
  assert.deepEqual(asAdmin, { userId: T.store }, "admin scoped to the tenant");
  assert.deepEqual(forbidden, { forbidden: true }, "a tenant can't target another account");

  const bad = await saveOwnerRecapEmail(T.store, { ownerRecapEmail: "nope", ownerRecapEmailEnabled: true });
  assert.deepEqual(bad, { status: 400, body: { error: "invalid_email", fields: ["ownerRecapEmail"] } });
  assert.deepEqual(await loadOwnerRecapEmail(T.store), { ownerRecapEmail: "", ownerRecapEmailEnabled: false }, "a 400 writes nothing");

  for (const [who, scope] of [["tenant", asTenant], ["admin", asAdmin]] as const) {
    const uid = (scope as { userId: string }).userId;
    const set = await saveOwnerRecapEmail(uid, { ownerRecapEmail: `  ${who.toUpperCase()}@Example.com `, ownerRecapEmailEnabled: true });
    assert.equal(set.status, 200);
    const want = { ownerRecapEmail: `${who}@example.com`, ownerRecapEmailEnabled: true };
    assert.deepEqual(await loadOwnerRecapEmail(uid), want, `${who}: normalised + saved`);
    // Omitting a field keeps it (each one, then both).
    await saveOwnerRecapEmail(uid, { ownerRecapEmailEnabled: true });
    assert.deepEqual(await loadOwnerRecapEmail(uid), want, `${who}: absent address kept`);
    await saveOwnerRecapEmail(uid, { ownerRecapEmail: `${who}@example.com` });
    assert.deepEqual(await loadOwnerRecapEmail(uid), want, `${who}: absent switch kept`);
    const noop = await saveOwnerRecapEmail(uid, {});
    assert.deepEqual(noop, { status: 200, body: { ...want, changedFields: [] } }, `${who}: empty body = no write`);
    assert.deepEqual(await loadOwnerRecapEmail(uid), want);
    await saveOwnerRecapEmail(uid, { ownerRecapEmailEnabled: false });
    assert.deepEqual(await loadOwnerRecapEmail(uid), { ...want, ownerRecapEmailEnabled: false }, `${who}: switch off, address kept`);
    await saveOwnerRecapEmail(uid, { ownerRecapEmail: "" });
    assert.deepEqual(await loadOwnerRecapEmail(uid), { ownerRecapEmail: "", ownerRecapEmailEnabled: false }, `${who}: '' clears`);
  }

  // ── 3. /api/calls/end, this route vs main's ───────────────────────────
  await exec(sql`UPDATE agent_configs SET owner_recap_email = 'owner@example.com' WHERE user_id = ${T.addressOff}`);
  await exec(sql`UPDATE agent_configs SET owner_recap_email_enabled = true WHERE user_id = ${T.onEmpty}`);
  for (const u of [T.on, T.failing, T.noName]) {
    await exec(sql`UPDATE agent_configs SET owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true WHERE user_id = ${u}`);
  }
  const transcript = [
    { role: "assistant", text: "Hello, Demo Salon." },
    { role: "user", text: "I'd like a haircut on Tuesday." },
    { role: "assistant", text: "Booked for Tuesday 10:00." },
  ];
  const post = async (route: typeof mine, userId: string, t = transcript) => {
    const res = await route.POST(
      new NextRequest("http://localhost/api/calls/end", {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": "mock-internal-secret" },
        body: JSON.stringify({ userId, fromNumber: "+15550100001", toNumber: "", transcript: t, durationSeconds: 60, callId: "call-mock-1" }),
      }),
    );
    const text = await res.text();
    const callId = (JSON.parse(text) as { callId?: string }).callId ?? "";
    return { status: res.status, bytes: callId ? text.replaceAll(callId, "<call-row-id>") : text };
  };
  const settle = () => new Promise((r) => setTimeout(r, 400)); // the email is fire-and-forget
  const sameAsMain = async (userId: string, label: string, t = transcript) => {
    const a = await post(mine, userId, t);
    await settle();
    const b = await post(main, userId, t);
    await settle();
    assert.equal(a.status, b.status, `${label}: same status as ${ref}`);
    assert.equal(a.bytes, b.bytes, `${label}: response bytes identical to ${ref}`);
    return a;
  };

  // Accounts that did not switch it on: 0 emails.
  for (const [label, u] of [
    ["existing account", T.existing],
    ["address but OFF", T.addressOff],
    ["ON but no address", T.onEmpty],
  ] as const) {
    const r = await sameAsMain(u, label);
    assert.equal(r.status, 200);
  }
  assert.equal(sends.length, 0, "0 emails for accounts that did not switch it on");
  assert.equal((await rows(sql`SELECT 1 FROM events WHERE source = 'email'`)).length, 0, "no email event either");

  // Skipped calls: empty transcript, greeting only → no email.
  await sameAsMain(T.on, "ON, empty transcript", []);
  await sameAsMain(T.on, "ON, greeting only", transcript.slice(0, 1));
  assert.equal(sends.length, 0, "skipped calls: no email");

  // ON + address: one email, the recap + the tenant's signature; same bytes.
  await sameAsMain(T.on, "ON");
  assert.equal(sends.length, 1, "ON: one email (main's route sends none)");
  assert.deepEqual(sends[0], ["owner@example.com", { forOwner: SUMMARY.for_owner, fromNumber: "+15550100001", businessName: "Demo Salon", locale: "en" }]);
  const sent = await rows<{ metadata: Record<string, unknown> }>(sql`SELECT metadata FROM events WHERE user_id = ${T.on} AND event = 'email_sent_owner'`);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent[0].metadata).includes("owner@example.com"), "no address in the sent event");

  // A second call within 5 minutes: deduped (real events query).
  await sameAsMain(T.on, "ON, second call");
  assert.equal(sends.length, 1, "dedup: still one email");

  // No business name → unsigned.
  await sameAsMain(T.noName, "ON, no business name");
  assert.equal(sends.length, 2);
  assert.equal(sends[1][1].businessName, "", "no name → unsigned");

  // Sender failure: same response, one error event without address / body.
  failNext = true;
  await sameAsMain(T.failing, "ON, sender throws");
  assert.equal(sends.length, 3);
  const failed = await rows<{ message: string; metadata: Record<string, unknown>; level: string }>(sql`
    SELECT message, metadata, level FROM events WHERE user_id = ${T.failing} AND event = 'email_failed_owner'`);
  assert.equal(failed.length, 1, "failure logged as an event");
  assert.equal(failed[0].level, "error");
  const dump = JSON.stringify(failed[0]);
  assert.ok(!dump.includes("owner@example.com"), "no recipient address in the failure event");
  assert.ok(!dump.includes("haircut") && !dump.includes("Dana"), "no recap body in the failure event");

  console.log("ALL OWNER-RECAP-EMAIL DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
