// The resend-verification route and the signup action with their real wiring
// (lib/verification-limits/deps.ts) against a THROWAWAY Postgres: real
// limiter, real users / email_verifications rows, real tenant provisioning.
// Only the sender (and the event logger) are replaced: nothing is ever sent.
// Skipped in a plain `npm test`. Run with:
//   bash scripts/verification-limits-db.sh
// (local Postgres on 127.0.0.1:55475, sets VERIFICATION_LIMITS_DB_URL).
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.com, documentation IP ranges).

import assert from "node:assert/strict";

const url = process.env.VERIFICATION_LIMITS_DB_URL;
if (!url) {
  console.log("SKIPPED verification-limits-db (set VERIFICATION_LIMITS_DB_URL — see scripts/verification-limits-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) if (/^(RESEND|EMAIL_FROM)/i.test(k)) delete process.env[k];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { resendDeps, signupDeps } = await import("../../lib/verification-limits/deps");
  const { handleResendVerification } = await import("../../lib/verification-limits/resend");
  const { signupWithEmail } = await import("../../lib/verification-limits/signup");
  const P = await import("../../lib/verification-limits/policy");

  type Row = Record<string, unknown>;
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown as Row[] | { rows: Row[] };
    return Array.isArray(r) ? r : r.rows;
  };
  const sent: string[] = [];
  const fakeSend = async (to: string) => {
    sent.push(to);
    return { ok: true };
  };
  const noLog = async () => {};
  const resend = { ...resendDeps, send: fakeSend, log: noLog };
  const signupD = { ...signupDeps, send: fakeSend, log: noLog };
  const signup = (email: string, ip: string) => signupWithEmail({ email, password: "longenough", locale: "en", ip }, signupD);
  const userCount = async (like: string) =>
    Number((await rows(sql`SELECT count(*)::int AS n FROM users WHERE email LIKE ${like}`))[0].n);
  const dbNow = async () => Number((await rows(sql`SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint AS n`))[0].n);
  const fillLedger = async (bucket: string, n: number) => {
    const now = await dbNow();
    const ledger: Record<string, number[]> = {};
    for (let i = 0; i < n; i++) ledger[`filler${i}`] = [now];
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES (${`rate_limit:${bucket}`}, ${JSON.stringify(ledger)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  };
  const reset = async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
    sent.length = 0;
  };

  // ── Signup ──────────────────────────────────────────────────────────────
  await reset();
  // A normal signup is unchanged: one users row (unverified trial), one code, one email.
  const ok = await signup("first@example.com", "203.0.113.10");
  assert.equal(ok.ok, true);
  const [u] = await rows(sql`SELECT id, email_verified, subscription_status FROM users WHERE email = 'first@example.com'`);
  assert.deepEqual([u.email_verified, u.subscription_status], [false, "trialing"]);
  assert.equal(Number((await rows(sql`SELECT count(*)::int AS n FROM email_verifications WHERE user_id = ${u.id}`))[0].n), 1);
  assert.deepEqual(sent, ["first@example.com"]);
  assert.deepEqual(await signup("first@example.com", "203.0.113.11"), { ok: false, error: "exists" });

  // The 6th from one IP in an hour → refused, no user row, no email.
  await reset();
  for (let i = 0; i < P.SIGNUP_PER_IP_PER_HOUR; i++) assert.equal((await signup(`ip-a-${i}@example.com`, "198.51.100.20")).ok, true);
  assert.deepEqual(await signup("ip-a-6th@example.com", "198.51.100.20"), { ok: false, error: "rate_limited" });
  assert.equal(await userCount("ip-a-6th@%"), 0);
  assert.equal(sent.length, P.SIGNUP_PER_IP_PER_HOUR);

  // The global ceiling → refused from a fresh IP, no user row, no email.
  await reset();
  await fillLedger(P.SIGNUP_BUCKET, P.SIGNUP_GLOBAL_PER_HOUR);
  assert.deepEqual(await signup("global@example.com", "198.51.100.30"), { ok: false, error: "rate_limited" });
  assert.equal(await userCount("global@%"), 0);
  assert.equal(sent.length, 0);

  // Concurrency on one IP: 20 parallel signups → exactly 5 accounts, 5 emails.
  await reset();
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => signup(`burst-${i}@example.com`, "198.51.100.40")));
  assert.equal(burst.filter((o) => o.ok).length, P.SIGNUP_PER_IP_PER_HOUR);
  assert.ok(burst.every((o) => o.ok || o.error === "rate_limited"));
  assert.equal(await userCount("burst-%"), P.SIGNUP_PER_IP_PER_HOUR);
  assert.equal(sent.length, P.SIGNUP_PER_IP_PER_HOUR);
  console.log("signup DB part passed");

  // ── Resend ──────────────────────────────────────────────────────────────
  await reset();
  const addr = "first@example.com"; // unverified account from above
  // Let the next resend pass both cooldowns (limiter row + the code's created_at).
  const passCooldowns = async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${`rate_limit:${P.RESEND_COOLDOWN_BUCKET}`}`);
    await db.execute(sql`UPDATE email_verifications SET created_at = created_at - interval '2 minutes'`);
  };
  await passCooldowns();
  let r = await handleResendVerification({ email: addr }, resend);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.deepEqual(sent, [addr]);
  // Cooldown still applies.
  r = await handleResendVerification({ email: addr }, resend);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "cooldown");
  // 6th in a day → 429 rate_limited, nothing sent.
  for (let i = 2; i <= P.RESEND_PER_ADDRESS_PER_DAY; i++) {
    await passCooldowns();
    assert.equal((await handleResendVerification({ email: addr }, resend)).status, 200, `resend #${i}`);
  }
  assert.equal(sent.length, P.RESEND_PER_ADDRESS_PER_DAY);
  await passCooldowns();
  r = await handleResendVerification({ email: addr }, resend);
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: "rate_limited" }]);
  assert.equal(sent.length, P.RESEND_PER_ADDRESS_PER_DAY);
  // Same answers for an address with no account.
  const ghost = "ghost@example.com";
  for (let i = 1; i <= P.RESEND_PER_ADDRESS_PER_DAY; i++) {
    await passCooldowns();
    assert.deepEqual((await handleResendVerification({ email: ghost }, resend)).body, { ok: true });
  }
  await passCooldowns();
  assert.deepEqual((await handleResendVerification({ email: ghost }, resend)).body, { ok: false, error: "rate_limited" });
  assert.equal(sent.length, P.RESEND_PER_ADDRESS_PER_DAY, "nothing sent to an address with no account");

  // No address in the limiter's stored rows.
  const stored = await rows(sql`SELECT key, value FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  assert.ok(stored.length >= 2);
  for (const s of stored) {
    assert.doesNotMatch(String(s.value), /@|example|first|ghost/, String(s.key));
  }

  // Global ceiling → 429 for a fresh address.
  await reset();
  const now = await dbNow();
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${`rate_limit:${P.RESEND_GLOBAL_BUCKET}`}, ${JSON.stringify({ all: Array(P.RESEND_GLOBAL_PER_HOUR).fill(now) })}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  r = await handleResendVerification({ email: "fresh@example.com" }, resend);
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: "rate_limited" }]);

  // Concurrency on one address: 10 parallel resends → exactly one accepted.
  await reset();
  await db.execute(sql`UPDATE email_verifications SET created_at = created_at - interval '2 minutes'`);
  const par = await Promise.all(Array.from({ length: 10 }, () => handleResendVerification({ email: "burst-0@example.com" }, resend)));
  assert.equal(par.filter((x) => x.status === 200).length, 1);
  assert.ok(par.every((x) => x.status === 200 || x.body.error === "cooldown"));
  assert.equal(sent.length, 1);
  console.log("resend DB part passed");

  console.log("ALL VERIFICATION-LIMITS-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
