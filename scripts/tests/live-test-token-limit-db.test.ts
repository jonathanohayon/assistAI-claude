// The live-test token's real wiring (lib/live-test/deps.ts) against a
// THROWAWAY Postgres: the shared ledger holds both limits under concurrency,
// admin scope uses the real resolveScopeUserId, outbound agents the real
// lookup. Only the session and the signer's credentials are replaced: tokens
// are signed with DUMMY keys. Skipped in a plain `npm test`. Run with:
//   bash scripts/live-test-token-limit-db.sh
// (local Postgres on 127.0.0.1:55477, sets LIVE_TEST_LIMIT_DB_URL).
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.com).

import assert from "node:assert/strict";

const url = process.env.LIVE_TEST_LIMIT_DB_URL;
if (!url) {
  console.log("SKIPPED live-test-token-limit-db (set LIVE_TEST_LIMIT_DB_URL — see scripts/live-test-token-limit-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) if (k.startsWith("LIVEKIT")) delete process.env[k];

const DUMMY = { url: "wss://mock.invalid", apiKey: "mock_key", apiSecret: "mock_secret_0123456789abcdef0123456789" };

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { liveTestDeps } = await import("../../lib/live-test/deps");
  const { handleLiveTestToken } = await import("../../lib/live-test/handler");
  const { mintLiveTestToken } = await import("../../lib/live-test/mint");
  const { LIVE_TEST_GLOBAL_LIMIT, LIVE_TEST_PER_ACCOUNT_LIMIT } = await import("../../lib/live-test/policy");
  // lib/rate-limit-db.ts stores bucket "live_test" under this app_settings key.
  const LEDGER = "rate_limit:live_test";

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const ADMIN = id(0xad);
  const AGENT = id(0xc3);
  const ACCOUNTS = Math.ceil(LIVE_TEST_GLOBAL_LIMIT / LIVE_TEST_PER_ACCOUNT_LIMIT) + 1;
  await exec(sql`DELETE FROM app_settings WHERE key = ${LEDGER}`);
  await exec(sql`DELETE FROM outbound_agents`);
  await exec(sql`DELETE FROM users`);
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  for (let n = 1; n <= ACCOUNTS; n++) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${id(n)}, ${`tenant-${n}@example.com`}, 'x', 'user')`);
  }
  await exec(sql`INSERT INTO outbound_agents (id, user_id, name) VALUES (${AGENT}, ${id(1)}, 'Mock agent')`);
  const resetLedger = () => exec(sql`DELETE FROM app_settings WHERE key = ${LEDGER}`);

  let signed = 0;
  const post = async (session: string, body?: unknown) => {
    const req = new NextRequest("http://localhost/api/live-test/token", {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await handleLiveTestToken(req, {
      ...liveTestDeps,
      session: async () => ({ userId: session, email: `${session.slice(-4)}@example.com` }),
      configured: () => true,
      mint: async (input) => {
        signed++;
        return mintLiveTestToken(DUMMY, input);
      },
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const meta = (r: { json: Record<string, unknown> }) =>
    JSON.parse(Buffer.from(String(r.json.token).split(".")[1], "base64url").toString("utf8")).metadata as string;

  // Real outbound-agent lookup: own agent → outbound_test; another tenant's → inbound.
  const own = await post(id(1), { agentId: AGENT });
  assert.equal(own.status, 200);
  assert.equal(meta(own), JSON.stringify({ source: "outbound_test", agentId: AGENT, userId: id(1) }));
  assert.equal(meta(await post(id(2), { agentId: AGENT })), JSON.stringify({ source: "web", userId: id(2) }));

  // Admin ?asUserId (real resolveScopeUserId) counts in the tenant's bucket; non-admin → 403.
  await resetLedger();
  for (let i = 0; i < 5; i++) assert.equal((await post(ADMIN, { asUserId: id(3) })).status, 200);
  assert.deepEqual((await post(id(2), { asUserId: id(3) })).json, { error: "Forbidden" });
  for (let i = 0; i < LIVE_TEST_PER_ACCOUNT_LIMIT - 5; i++) assert.equal((await post(id(3))).status, 200);
  assert.deepEqual((await post(id(3))).json, { error: "rate_limited", scope: "account" }, "the 21st (admin + tenant) → account");
  assert.deepEqual((await post(ADMIN, { asUserId: id(3) })).json, { error: "rate_limited", scope: "account" });
  const [l1] = (await exec(sql`SELECT value FROM app_settings WHERE key = ${LEDGER}`)) as unknown as { value: string }[];
  const byAccount = JSON.parse(l1.value) as Record<string, number[]>;
  assert.equal(byAccount[id(3)].length, LIVE_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(byAccount[ADMIN], undefined, "admin mints are not in the admin's bucket");

  // Concurrency, one account: 40 parallel → exactly 20 signed.
  await resetLedger();
  signed = 0;
  const burst = await Promise.all(Array.from({ length: 40 }, () => post(id(4))));
  assert.equal(burst.filter((r) => r.status === 200).length, LIVE_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(burst.filter((r) => r.status === 429 && r.json.scope === "account").length, 40 - LIVE_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(signed, LIVE_TEST_PER_ACCOUNT_LIMIT, "no token signed over the limit under concurrency");

  // Concurrency, global: (ACCOUNTS-1) accounts × 20 in parallel → exactly the ceiling; then a fresh account → global.
  await resetLedger();
  signed = 0;
  const n = (ACCOUNTS - 1) * LIVE_TEST_PER_ACCOUNT_LIMIT;
  assert.ok(n >= LIVE_TEST_GLOBAL_LIMIT);
  const many = await Promise.all(Array.from({ length: n }, (_, i) => post(id((i % (ACCOUNTS - 1)) + 1))));
  assert.equal(many.filter((r) => r.status === 200).length, LIVE_TEST_GLOBAL_LIMIT);
  assert.ok(many.every((r) => r.status === 200 || (r.status === 429 && r.json.scope === "global")));
  assert.equal(signed, LIVE_TEST_GLOBAL_LIMIT, "the global ceiling holds under concurrency");
  assert.deepEqual((await post(id(ACCOUNTS))).json, { error: "rate_limited", scope: "global" });

  // The ledger holds only account ids + timestamps.
  const [l2] = (await exec(sql`SELECT value FROM app_settings WHERE key = ${LEDGER}`)) as unknown as { value: string }[];
  assert.doesNotMatch(l2.value, /@|livetest|web-/);

  console.log("ALL LIVE-TEST-TOKEN-LIMIT-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
