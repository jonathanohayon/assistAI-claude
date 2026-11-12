// The email-test route's real wiring (lib/email-test/deps.ts) against a
// THROWAWAY Postgres: the ledger holds the limits under concurrency, the admin
// scope uses the real resolveScopeUserId, nothing stored carries an address.
// Only the session and the sender are replaced: nothing is ever sent.
// Skipped in a plain `npm test`. Run with:
//   bash scripts/email-test-hardening-db.sh
// (local Postgres on 127.0.0.1:55472, sets EMAIL_TEST_HARDENING_DB_URL).
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.com).

import assert from "node:assert/strict";

const url = process.env.EMAIL_TEST_HARDENING_DB_URL;
if (!url) {
  console.log("SKIPPED email-test-hardening-db (set EMAIL_TEST_HARDENING_DB_URL — see scripts/email-test-hardening-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) if (/^(RESEND|EMAIL_FROM)/.test(k)) delete process.env[k];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { resolveScopeUserId } = await import("../../lib/admin-impersonate");
  const { emailTestDeps } = await import("../../lib/email-test/deps");
  const { handleEmailTest } = await import("../../lib/email-test/handler");
  // lib/rate-limit-db.ts stores bucket "email_test" under this app_settings key.
  const EMAIL_TEST_LEDGER_SETTING = "rate_limit:email_test";
  const { EMAIL_TEST_GLOBAL_LIMIT, EMAIL_TEST_PER_ACCOUNT_LIMIT } = await import("../../lib/email-test/policy");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const ADMIN = id(0xad);
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM app_settings WHERE key = ${EMAIL_TEST_LEDGER_SETTING}`);
  await exec(sql`DELETE FROM users`);
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  for (let n = 1; n <= 13; n++) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${id(n)}, ${`tenant-${n}@example.com`}, 'x', 'user')`);
  }
  // Saved recap addresses (agent_configs.owner_recap_email), switch OFF on purpose:
  // a test may go to a saved address before it is switched on.
  await exec(sql`DELETE FROM agent_configs`);
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_recap_email, owner_recap_email_enabled)
    VALUES (${id(6)}, 'x', 'x', ' Recap-6@Example.com ', false), (${id(7)}, 'x', 'x', '', false), (${ADMIN}, 'x', 'x', 'admin-recap@example.com', true)`);
  const resetLedger = () => exec(sql`DELETE FROM app_settings WHERE key = ${EMAIL_TEST_LEDGER_SETTING}`);

  const sent: string[] = [];
  const post = async (session: string, to: string, query = "") => {
    const req = new NextRequest(`http://localhost/api/dashboard/notifications/email-test${query}`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
    const res = await handleEmailTest(req, {
      ...emailTestDeps,
      resolveTarget: async (r) => {
        const scope = await resolveScopeUserId({ sessionUserId: session, asUserId: r.nextUrl.searchParams.get("asUserId") });
        return "forbidden" in scope ? { forbidden: true as const } : scope;
      },
      send: async (addr) => {
        sent.push(addr);
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, id: `msg-${sent.length}` };
      },
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  // Own login address passes; another address → 403.
  const own = await post(id(1), "TENANT-1@example.com ");
  assert.equal(own.status, 200);
  assert.deepEqual(sent, ["tenant-1@example.com"]);
  assert.deepEqual((await post(id(1), "tenant-2@example.com")).json, { error: "recipient_not_allowed" });
  // Admin ?asUserId: tenant's own address passes, any other → 403; non-admin asUserId → 403 forbidden.
  assert.equal((await post(ADMIN, "tenant-3@example.com", `?asUserId=${id(3)}`)).status, 200);
  assert.deepEqual((await post(ADMIN, "admin@example.com", `?asUserId=${id(3)}`)).json, { error: "recipient_not_allowed" });
  assert.deepEqual((await post(id(2), "tenant-3@example.com", `?asUserId=${id(3)}`)).json, { error: "forbidden" });

  // Saved recap address passes (switch OFF), normalised; login still passes.
  sent.length = 0;
  assert.equal((await post(id(6), "RECAP-6@example.com ")).status, 200);
  assert.equal((await post(id(6), "tenant-6@example.com")).status, 200);
  assert.deepEqual(sent, ["recap-6@example.com", "tenant-6@example.com"]);
  // Empty saved address (and no agent config at all, tenant-1): only the login email.
  assert.deepEqual((await post(id(7), "recap-6@example.com")).json, { error: "recipient_not_allowed" });
  assert.equal((await post(id(7), "tenant-7@example.com")).status, 200);
  // Admin ?asUserId: the TENANT's recap address passes, the admin's own recap address does not.
  assert.equal((await post(ADMIN, "recap-6@example.com", `?asUserId=${id(6)}`)).status, 200);
  assert.deepEqual((await post(ADMIN, "admin-recap@example.com", `?asUserId=${id(6)}`)).json, { error: "recipient_not_allowed" });

  // Sequential: tenant-1 has 1 → 4 more pass, the 6th → 429 account.
  for (let i = 0; i < EMAIL_TEST_PER_ACCOUNT_LIMIT - 1; i++) assert.equal((await post(id(1), "tenant-1@example.com")).status, 200);
  assert.deepEqual((await post(id(1), "tenant-1@example.com")).json, { error: "rate_limited", scope: "account" });

  // Concurrency, one account: 10 parallel → exactly 5 sent.
  await resetLedger();
  sent.length = 0;
  const burst = await Promise.all(Array.from({ length: 10 }, () => post(id(4), "tenant-4@example.com")));
  assert.equal(burst.filter((r) => r.status === 200).length, EMAIL_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(burst.filter((r) => r.status === 429 && r.json.scope === "account").length, 10 - EMAIL_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(sent.length, EMAIL_TEST_PER_ACCOUNT_LIMIT, "at most 5 sends under concurrency");

  // Concurrency, global: 12 accounts × 5 in parallel = 60 → exactly 50 sent; then a 13th account → 429 global.
  await resetLedger();
  sent.length = 0;
  const many = await Promise.all(
    Array.from({ length: 12 * EMAIL_TEST_PER_ACCOUNT_LIMIT }, (_, i) => {
      const n = (i % 12) + 1;
      return post(id(n), `tenant-${n}@example.com`);
    }),
  );
  assert.equal(many.filter((r) => r.status === 200).length, EMAIL_TEST_GLOBAL_LIMIT);
  assert.equal(many.filter((r) => r.status === 429 && r.json.scope === "global").length, 12 * EMAIL_TEST_PER_ACCOUNT_LIMIT - EMAIL_TEST_GLOBAL_LIMIT);
  assert.equal(sent.length, EMAIL_TEST_GLOBAL_LIMIT, "the global ceiling holds under concurrency");
  assert.deepEqual((await post(id(13), "tenant-13@example.com")).json, { error: "rate_limited", scope: "global" });

  // Nothing stored carries an address: the ledger (ids + timestamps) and the events.
  const [ledger] = (await exec(sql`SELECT value FROM app_settings WHERE key = ${EMAIL_TEST_LEDGER_SETTING}`)) as unknown as { value: string }[];
  assert.doesNotMatch(ledger.value, /@/);
  const total = Object.values(JSON.parse(ledger.value) as Record<string, number[]>).reduce((s, l) => s + l.length, 0);
  assert.equal(total, EMAIL_TEST_GLOBAL_LIMIT, "only accepted attempts are recorded (bounded ledger)");
  const evs = (await exec(sql`SELECT event, message, metadata::text AS m FROM events`)) as unknown as { event: string; message: string; m: string }[];
  assert.ok(evs.some((e) => e.event === "email_test_sent"));
  for (const e of evs) assert.doesNotMatch(`${e.message} ${e.m}`, /@/, e.event);

  // A corrupt ledger reads as empty (no stuck 500).
  await exec(sql`UPDATE app_settings SET value = '{oops' WHERE key = ${EMAIL_TEST_LEDGER_SETTING}`);
  assert.equal((await post(id(5), "tenant-5@example.com")).status, 200);

  console.log("ALL EMAIL-TEST-HARDENING-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
