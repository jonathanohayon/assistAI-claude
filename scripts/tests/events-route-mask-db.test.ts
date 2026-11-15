// GET /api/dashboard/events through the REAL handler, against a real Postgres
// seeded with OLD-style rows (inserted raw, as stored before #332): a full
// E.164 caller number and an email address in metadata AND in the message,
// plus a *Hash key. The serialised response must contain none of them, for
// EVERY caller: a tenant, an admin on a tenant (?asUserId) and an admin on
// their own events. There is no raw mode. Mock data only (+1555, example.com).
// Runs only when EVENTS_MASK_DB_URL points at a THROWAWAY, migrated database
// (scripts/events-route-mask-db.sh starts one and maps "@/auth" to a test
// session stub); otherwise skipped, so plain `npm test` never touches a DB.

import assert from "node:assert/strict";

const url = process.env.EVENTS_MASK_DB_URL;
if (!url) {
  console.log("SKIPPED events-route-mask-db (set EVENTS_MASK_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
process.env.DATABASE_URL = url;

const CALLER = "+15550100123";
const CALLER_SPACED = "+1 555 010 0123";
const TENANT_LINE = "+15550100999";
const EMAIL = "ana.caller@example.com";
const HASH_VALUE = "a1b2c3d4e5f6";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { setTestSession } = await import("./helpers/auth-session-stub");
  const { GET } = await import("../../app/api/dashboard/events/route");
  const { PHONE_RE } = await import("../../lib/pii-mask");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM users`);

  const TENANT = "00000000-0000-4000-8000-00000000000a";
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${TENANT}, 'tenant@example.com', 'x', 'user')`);
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);

  // Old-style rows, written RAW (no lib/logger scrub), for the tenant and the admin.
  const seed = async (userId: string) => {
    const started = { roomName: `call-${CALLER}`, origin: { kind: "sip", calledNumber: TENANT_LINE } };
    const received = {
      fromNumber: CALLER,
      toNumber: TENANT_LINE,
      fromHash: HASH_VALUE,
      callId: "c-old",
      ownerEmail: EMAIL,
      nested: { callerPhone: CALLER, emailHash: HASH_VALUE, note: `rappeler ${CALLER_SPACED} ou ${EMAIL}` },
    };
    await exec(sql`INSERT INTO events (user_id, level, source, event, message, metadata, created_at)
                   VALUES (${userId}, 'info', 'agent', 'call_started', 'Appel démarré',
                           ${JSON.stringify(started)}::jsonb, now() - interval '2 minutes')`);
    await exec(sql`INSERT INTO events (user_id, level, source, event, message, metadata, created_at)
                   VALUES (${userId}, 'warn', 'agent', 'call_received',
                           ${`Appel reçu de ${CALLER} (${CALLER_SPACED}), récap à ${EMAIL}`},
                           ${JSON.stringify(received)}::jsonb, now() - interval '1 minute')`);
  };
  await seed(TENANT);
  await seed(ADMIN);

  const call = async (as: string, qs = "") => {
    setTestSession(as);
    const res = await GET(new NextRequest(`http://localhost/api/dashboard/events${qs}`));
    assert.equal(res.status, 200, `${as}${qs}: status`);
    return res.text();
  };

  const assertClean = (body: string, label: string) => {
    const json = JSON.parse(body) as { events: Array<{ event: string; message: string; metadata: Record<string, unknown> }> };
    assert.equal(json.events.length, 2, `${label}: both seeded rows returned`);
    const rest = body.split(TENANT_LINE).join("");
    assert.ok(!body.includes(CALLER) && !body.includes(CALLER_SPACED), `${label}: no caller number: ${body}`);
    assert.ok(!body.includes("0100123") && !body.includes("010 0123"), `${label}: no caller digits beyond the last 4`);
    assert.ok(!new RegExp(PHONE_RE.source).test(rest), `${label}: no phone number besides the tenant line: ${body}`);
    assert.ok(!body.includes(EMAIL) && !/@example\.com/.test(body), `${label}: no email: ${body}`);
    assert.ok(!/Hash/.test(body), `${label}: no *Hash key: ${body}`);
    assert.ok(!body.includes(HASH_VALUE), `${label}: no hash value: ${body}`);
    // What Monitoring needs is still there.
    const r = json.events.find((e) => e.event === "call_received")!;
    assert.equal(r.metadata["toNumber"], TENANT_LINE, `${label}: tenant line kept`);
    assert.equal(r.metadata["fromNumber"], "…0123", `${label}: caller as last 4`);
    assert.equal(r.message, "Appel reçu de …0123 (…0123), récap à [email]", `${label}: message masked`);
  };

  assertClean(await call(TENANT), "tenant");
  assertClean(await call(ADMIN, `?asUserId=${TENANT}`), "admin ?asUserId");
  assertClean(await call(ADMIN), "admin own view");

  // Read-time only: the stored rows are unchanged.
  const stored = await exec(sql`SELECT count(*)::int AS n FROM events WHERE metadata->>'fromNumber' = ${CALLER}`);
  const rows = (Array.isArray(stored) ? stored : (stored as { rows: unknown[] }).rows) as Array<{ n: number }>;
  assert.equal(rows[0].n, 2, "rows are not rewritten");

  console.log("events-route-mask-db: OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
