// POST /api/auth/verify-email with its real wiring (lib/verification-limits/
// deps.ts verifyDeps) against a THROWAWAY Postgres: real limiter (row lock
// under concurrency), real users / email_verifications rows, real bcrypt.
// Only the event logger is replaced (to inspect it); accounts are created
// through the real signup action with a fake sender that keeps the code, so
// nothing is ever sent. Skipped in a plain `npm test`. Run with:
//   bash scripts/verify-email-db.sh
// (local Postgres on 127.0.0.1:<free port>, sets VERIFY_EMAIL_DB_URL).
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.com, documentation IP ranges).

import assert from "node:assert/strict";

const url = process.env.VERIFY_EMAIL_DB_URL;
if (!url) {
  console.log("SKIPPED verify-email-db (set VERIFY_EMAIL_DB_URL — see scripts/verify-email-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) if (/^(RESEND|EMAIL_FROM)/i.test(k)) delete process.env[k];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { signupDeps, verifyDeps } = await import("../../lib/verification-limits/deps");
  const { signupWithEmail } = await import("../../lib/verification-limits/signup");
  const { handleVerifyEmail } = await import("../../lib/verification-limits/verify");
  const P = await import("../../lib/verification-limits/policy");
  type LogEvent = import("../../lib/logger").LogEvent;

  type Row = Record<string, unknown>;
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown as Row[] | { rows: Row[] };
    return Array.isArray(r) ? r : r.rows;
  };
  const codes = new Map<string, string>();
  const logs: LogEvent[] = [];
  const signupD = {
    ...signupDeps,
    send: async (to: string, code: string) => {
      codes.set(to, code);
      return { ok: true };
    },
    log: async () => {},
  };
  const deps = { ...verifyDeps, log: async (ev: LogEvent) => void logs.push(ev) };
  const resetLimits = async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  };
  const verify = (email: string, code: string, ip = "203.0.113.10") =>
    handleVerifyEmail({ body: { email, code }, headers: new Headers({ "x-real-ip": ip }) }, deps);
  const bytes = (r: { status: number; body: unknown; retryAfterSec?: number }) =>
    JSON.stringify([r.status, r.body, r.retryAfterSec ?? null]);
  const wrongFor = (code: string) => (code === "0000" ? "0001" : "0000");
  const isVerified = async (email: string) =>
    (await rows(sql`SELECT email_verified FROM users WHERE email = ${email}`))[0].email_verified === true;

  // Mock accounts, created through the real signup action.
  const addrs = ["unverified@example.com", "verified@example.com", "expired@example.com", "nocode@example.com", "timing@example.com"];
  for (const [i, a] of addrs.entries()) {
    await resetLimits();
    const s = await signupWithEmail({ email: a, password: "longenough", locale: "en", ip: `198.51.100.${i + 1}` }, signupD);
    assert.equal(s.ok, true, a);
  }
  await resetLimits();
  assert.equal(bytes(await verify("verified@example.com", codes.get("verified@example.com")!)), JSON.stringify([200, { ok: true }, null]));
  assert.ok(await isVerified("verified@example.com"));
  await db.execute(sql`UPDATE email_verifications SET expires_at = now() - interval '1 minute'
    WHERE user_id = (SELECT id FROM users WHERE email = 'expired@example.com')`);
  await db.execute(sql`UPDATE email_verifications SET consumed_at = now()
    WHERE user_id = (SELECT id FROM users WHERE email = 'nocode@example.com')`);

  // ── Neutral answer ────────────────────────────────────────────────────────
  await resetLimits();
  const invalid = JSON.stringify([400, { ok: false, error: "invalid_code" }, null]);
  const neutral: Array<[string, string, string]> = [
    ["unknown address", "nobody@example.com", "1234"],
    ["existing unverified, wrong code", "unverified@example.com", wrongFor(codes.get("unverified@example.com")!)],
    ["existing verified, wrong code", "verified@example.com", wrongFor(codes.get("verified@example.com")!)],
    ["existing unverified, expired code", "expired@example.com", codes.get("expired@example.com")!],
    ["existing unverified, no active code", "nocode@example.com", codes.get("nocode@example.com")!],
  ];
  for (const [label, email, code] of neutral) {
    assert.equal(bytes(await verify(email, code, `192.0.2.${neutral.findIndex((n) => n[0] === label) + 1}`)), invalid, label);
  }
  assert.equal(await isVerified("expired@example.com"), false);
  assert.equal(await isVerified("nocode@example.com"), false);
  console.log("neutral answers identical on a real database");

  // ── Success ───────────────────────────────────────────────────────────────
  await resetLimits();
  const ok = await verify("unverified@example.com", codes.get("unverified@example.com")!);
  assert.equal(bytes(ok), JSON.stringify([200, { ok: true }, null]));
  assert.ok(await isVerified("unverified@example.com"));
  // Resubmitting the same code, and the latest code of an already verified account → same success.
  assert.equal(bytes(await verify("unverified@example.com", codes.get("unverified@example.com")!)), bytes(ok));
  assert.equal(bytes(await verify("verified@example.com", codes.get("verified@example.com")!)), bytes(ok));
  // An already verified account's latest code stops matching once it is past its TTL.
  await db.execute(sql`UPDATE email_verifications SET expires_at = now() - interval '1 minute'
    WHERE user_id = (SELECT id FROM users WHERE email = 'verified@example.com')`);
  assert.equal(bytes(await verify("verified@example.com", codes.get("verified@example.com")!)), invalid);
  console.log("success unchanged; already verified + correct code → success");

  // ── Real limiter: per address, per IP, global, concurrency ────────────────
  await resetLimits();
  const LIMITED = JSON.stringify([429, { ok: false, error: "rate_limited" }]);
  const isLimited = (r: { status: number; body: unknown; retryAfterSec?: number }) =>
    JSON.stringify([r.status, r.body]) === LIMITED && (r.retryAfterSec ?? 0) > 0;
  // 30 parallel tries on one address from 30 IPs → exactly 10 pass the limits.
  let par = await Promise.all(Array.from({ length: 30 }, (_, i) => verify("nobody@example.com", "1111", `192.0.2.${i + 1}`)));
  assert.equal(par.filter((r) => bytes(r) === invalid).length, P.VERIFY_PER_ADDRESS_PER_HOUR);
  assert.equal(par.filter(isLimited).length, 30 - P.VERIFY_PER_ADDRESS_PER_HOUR);
  // An existing address gets the same 429 once over the limit.
  await resetLimits();
  for (let i = 0; i < P.VERIFY_PER_ADDRESS_PER_HOUR; i++) await verify("timing@example.com", "1111", `192.0.2.${i + 1}`);
  const overExisting = await verify("timing@example.com", codes.get("timing@example.com")!, "192.0.2.150");
  assert.ok(isLimited(overExisting));
  assert.equal(await isVerified("timing@example.com"), false, "the right code is refused once over the limit");
  // 30 parallel tries from one IP on 30 addresses → exactly 10 pass the limits.
  await resetLimits();
  par = await Promise.all(Array.from({ length: 30 }, (_, i) => verify(`burst-${i}@example.com`, "1111", "198.51.100.77")));
  assert.equal(par.filter((r) => bytes(r) === invalid).length, P.VERIFY_PER_IP_PER_HOUR);
  assert.equal(par.filter(isLimited).length, 30 - P.VERIFY_PER_IP_PER_HOUR);
  // Global ceiling: fresh IP, fresh address → refused.
  await resetLimits();
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${`rate_limit:${P.VERIFY_GLOBAL_BUCKET}`}, ${JSON.stringify({ all: Array(P.VERIFY_GLOBAL_PER_HOUR).fill(Date.now()) })}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  assert.ok(isLimited(await verify("fresh@example.com", "1111", "203.0.113.200")));
  console.log("real limiter: per address, per IP (concurrent), global");

  // ── No address or IP in clear in limiter rows or logs ─────────────────────
  await resetLimits();
  for (const a of addrs) await verify(a, "1111", "203.0.113.55");
  const stored = await rows(sql`SELECT key, value FROM app_settings WHERE key LIKE 'rate_limit:verif_verify%'`);
  assert.equal(stored.length, 3);
  for (const s of stored) assert.doesNotMatch(String(s.value), /@|example|203\.0\.113|198\.51\.100|192\.0\.2/, String(s.key));
  assert.ok(logs.length > 0);
  assert.doesNotMatch(JSON.stringify(logs), /@|example\.com/);
  console.log("no address in limiter rows or logs");

  // ── Timing: unknown vs existing address, both pay one bcrypt compare ──────
  const time = async (email: string) => {
    const ts: number[] = [];
    for (let i = 0; i < 7; i++) {
      await resetLimits();
      const t0 = performance.now();
      await verify(email, "1111", "203.0.113.66");
      ts.push(performance.now() - t0);
    }
    return ts.sort((a, b) => a - b)[3];
  };
  await time("nobody@example.com"); // warm-up (dummy hash, connections)
  const tUnknown = await time("nobody@example.com");
  const tExisting = await time("timing@example.com");
  console.log(`median ms: unknown ${tUnknown.toFixed(1)}, existing ${tExisting.toFixed(1)}`);
  assert.ok(tUnknown > 0.5 * tExisting && tUnknown < 2 * tExisting, "no obvious timing gap");

  console.log("ALL VERIFY-EMAIL-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
