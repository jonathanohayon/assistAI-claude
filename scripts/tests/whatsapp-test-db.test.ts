// WhatsApp test button against a real, migrated Postgres: the saved number
// read from agent_configs, the shared DB limiter (lib/rate-limit-db.ts), the
// admin ?asUserId scope (resolveScopeUserId, which resolveTargetUserId wraps).
// Only the sender is replaced: no provider is ever called. Mock data only.
// Runs only with WHATSAPP_TEST_DB_URL (a THROWAWAY database; it deletes users):
//   bash scripts/whatsapp-test-db.sh
// Otherwise skipped, so plain `npm test` never touches a database.

import assert from "node:assert/strict";

const url = process.env.WHATSAPP_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED whatsapp-test-db (set WHATSAPP_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
if (!/^postgres:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(url)) {
  console.error("whatsapp-test-db: only a 127.0.0.1 throwaway URL is accepted");
  process.exit(1);
}
process.env.DATABASE_URL = url;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { resolveScopeUserId } = await import("../../lib/admin-impersonate");
  const { runWhatsAppTest, WHATSAPP_TEST_LIMITS } = await import("../../lib/notifications/whatsapp-test");
  const { whatsAppTestDeps } = await import("../../lib/notifications/whatsapp-test-deps");
  type Opts = import("../../lib/whatsapp").WhatsAppOptions;

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  await exec(sql`DELETE FROM users`); // cascades to agent_configs
  await exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);

  const ADMIN = "00000000-0000-4000-8000-0000000000a1";
  const OWNER = "00000000-0000-4000-8000-0000000000b1";
  const TENANT = "00000000-0000-4000-8000-0000000000c1";
  const EMPTY = "00000000-0000-4000-8000-0000000000d1";
  const users: [string, string, string, string][] = [
    [ADMIN, "admin@example.test", "admin", "+15550009999"],
    [OWNER, "owner@example.test", "user", "+15550001111"],
    [TENANT, "tenant@example.test", "user", "+15550003333"],
    [EMPTY, "empty@example.test", "user", ""],
  ];
  for (const [id, email, role, wa] of users) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${id}, ${email}, 'x', ${role})`);
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_whatsapp)
                   VALUES (${id}, 'mock', 'mock', ${wa})`);
  }

  const sent: Opts[] = [];
  const deps = {
    ...whatsAppTestDeps,
    isConfigured: () => true,
    templateSid: () => undefined,
    send: async (o: Opts) => {
      sent.push(o);
      return { ok: true, sid: "SM-mock" };
    },
  };
  /** The route: scope like resolveTargetUserId, then the logic. */
  const post = async (sessionUserId: string, asUserId: string | null, body: unknown) => {
    const scope = await resolveScopeUserId({ sessionUserId, asUserId });
    if ("forbidden" in scope) return { status: 403, body: { error: "Forbidden" } };
    return runWhatsAppTest({ userId: scope.userId, displayName: null, body }, deps);
  };

  // Own saved number passes; another → 403; no saved number → 409.
  assert.equal((await post(OWNER, null, { to: "+15550001111" })).status, 200);
  assert.deepEqual((await post(OWNER, null, { to: "+15550002222" })).body, { error: "recipient_not_allowed" });
  assert.deepEqual((await post(EMPTY, null, {})).body, { error: "no_saved_number" });
  console.log("  ✓ saved number only (200 / 403 / 409)");

  // Admin ?asUserId → the TENANT's saved number; another (the admin's own) → 403.
  assert.equal((await post(ADMIN, TENANT, { to: "+15550003333" })).status, 200);
  assert.equal(sent.at(-1)?.to, "+15550003333");
  assert.deepEqual((await post(ADMIN, TENANT, { to: "+15550009999" })).body, { error: "recipient_not_allowed" });
  // A non-admin cannot scope to another account.
  assert.equal((await post(OWNER, TENANT, {})).status, 403);
  console.log("  ✓ admin ?asUserId uses the tenant's saved number");

  // Concurrency against the real limiter: 10 parallel for a fresh account → 5 sends.
  await exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  sent.length = 0;
  const rs = await Promise.all(Array.from({ length: 10 }, () => post(TENANT, null, {})));
  assert.equal(rs.filter((r) => r.status === 200).length, WHATSAPP_TEST_LIMITS.perAccount);
  assert.equal(sent.length, WHATSAPP_TEST_LIMITS.perAccount);
  const limited = rs.filter((r) => r.status === 429);
  assert.equal(limited.length, 5);
  for (const r of limited) assert.deepEqual(r.body, { error: "rate_limited", scope: "account" });
  // The 6th, sequentially, is still limited.
  assert.deepEqual((await post(TENANT, null, {})).body, { error: "rate_limited", scope: "account" });
  console.log("  ✓ 10 parallel → 5 sends, then 429 scope account");

  // Global ceiling: pre-fill the bucket's ledger with other accounts' attempts.
  await exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  const [{ now_ms }] = (await exec(
    sql`SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint AS now_ms`,
  )) as unknown as { now_ms: string }[];
  const ledger: Record<string, number[]> = {};
  for (let i = 0; i < WHATSAPP_TEST_LIMITS.global; i++) (ledger[`other-${i % 20}`] ??= []).push(Number(now_ms) - 1000);
  await exec(sql`INSERT INTO app_settings (key, value, updated_at)
                 VALUES (${"rate_limit:" + WHATSAPP_TEST_LIMITS.bucket}, ${JSON.stringify(ledger)}, now())`);
  assert.deepEqual((await post(OWNER, null, {})).body, { error: "rate_limited", scope: "global" });
  console.log("  ✓ global ceiling → 429 scope global");

  // What the ledger stores: account ids and timestamps, never a number.
  const stored = (await exec(sql`SELECT value FROM app_settings WHERE key LIKE 'rate_limit:%'`)) as unknown as { value: string }[];
  for (const r of stored) assert.doesNotMatch(r.value, /1555/);

  console.log("ALL WHATSAPP-TEST DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
