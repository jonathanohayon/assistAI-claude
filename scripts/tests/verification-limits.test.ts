// Caps on verification emails (resend route) and signups (server action):
// lib/verification-limits/{policy,resend,signup}.ts. In-memory limiter built
// on the real decision (decideRateLimit) with a fake clock; fake sender, so no
// email is ever sent. The real-Postgres part is
// scripts/tests/verification-limits-db.test.ts.
// Run with:  npx tsx scripts/tests/verification-limits.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import {
  limiterKey,
  RESEND_GLOBAL_PER_HOUR,
  RESEND_PER_ADDRESS_PER_DAY,
  SIGNUP_GLOBAL_PER_HOUR,
  SIGNUP_PER_IP_PER_HOUR,
  VERIFICATION_ERRORS,
} from "../../lib/verification-limits/policy";
import { handleResendVerification, type ResendDeps } from "../../lib/verification-limits/resend";
import { signupWithEmail, type SignupDeps } from "../../lib/verification-limits/signup";
import { PATTERN } from "../tenant-bundle-match.mjs";

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const neutral = (body: unknown) => {
  const s = JSON.stringify(body);
  assert.doesNotMatch(s, SUPPLIER, s);
  assert.doesNotMatch(s, /resend|_API_KEY|process\.env|exception|provider/i, s);
};

function fakeLimiter() {
  const ledgers = new Map<string, RateLimitLedger>();
  const clock = { now: 1_000_000_000 };
  const consume: ResendDeps["consume"] = async ({ bucket, accountId, windowMs, perAccount, global }) => {
    const { result, next } = decideRateLimit(ledgers.get(bucket) ?? {}, accountId, clock.now, { windowMs, perAccount, global });
    ledgers.set(bucket, next);
    return result;
  };
  return { ledgers, clock, consume };
}

const MIN = 60_000;

// ── Resend ────────────────────────────────────────────────────────────────
function resendWorld(users: Record<string, { id: string; emailVerified: boolean }> = {}) {
  const lim = fakeLimiter();
  const sent: string[] = [];
  const state = { sendFails: false, dbCooldown: false };
  const deps: ResendDeps = {
    consume: lim.consume,
    findUser: async (email) => (users[email] ? { ...users[email], locale: "en" } : null),
    createCode: async () => (state.dbCooldown ? { ok: false, reason: "cooldown", cooldownSeconds: 30 } : { ok: true, code: "1234" }),
    send: async (to) => {
      if (state.sendFails) return { ok: false, error: "provider said RESEND_API_KEY invalid" };
      sent.push(to);
      return { ok: true };
    },
    log: async () => {},
  };
  return { ...lim, sent, state, deps };
}

async function resendCases() {
  const known = "known@example.com";
  const w = resendWorld({ [known]: { id: "u1", emailVerified: false } });

  // A normal resend: 200 { ok: true }, one email.
  let r = await handleResendVerification({ email: " Known@Example.com " }, w.deps);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.deepEqual(w.sent, [known]);

  // Cooldown still applies (60 s per address): 429 cooldown, nothing sent.
  r = await handleResendVerification({ email: known }, w.deps);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "cooldown");
  assert.ok((r.body.cooldownSeconds as number) >= 1 && (r.body.cooldownSeconds as number) <= 60);
  assert.equal(w.sent.length, 1);
  // The DB cooldown (code < 60 s old, e.g. from signup) → uniform 200, nothing sent.
  w.clock.now += MIN;
  w.state.dbCooldown = true;
  r = await handleResendVerification({ email: known }, w.deps);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.equal(w.sent.length, 1);
  w.state.dbCooldown = false;

  // 5 per day per address: sends 3, 4, 5 go through, the 6th is 429 rate_limited.
  for (let i = 3; i <= RESEND_PER_ADDRESS_PER_DAY; i++) {
    w.clock.now += MIN;
    r = await handleResendVerification({ email: known }, w.deps);
    assert.equal(r.status, 200, `send #${i}`);
  }
  assert.equal(w.sent.length, RESEND_PER_ADDRESS_PER_DAY - 1);
  w.clock.now += MIN;
  r = await handleResendVerification({ email: known }, w.deps);
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: "rate_limited" }]);
  assert.ok(r.retryAfterSec && r.retryAfterSec > 3600, "frees up after a day, not an hour");
  assert.equal(w.sent.length, RESEND_PER_ADDRESS_PER_DAY - 1, "nothing sent once over the limit");
  // A day later the address frees up.
  w.clock.now += 24 * 60 * MIN;
  assert.equal((await handleResendVerification({ email: known }, w.deps)).status, 200);

  // No address in the limiter's stored rows: keys are sha256 hex.
  for (const [bucket, ledger] of w.ledgers) {
    for (const k of Object.keys(ledger)) {
      assert.ok(k === "all" || /^[0-9a-f]{64}$/.test(k), `${bucket}: key ${k}`);
      assert.ok(!k.includes("@") && !k.includes("known"));
    }
  }
  assert.ok(w.ledgers.get("verif_resend_address")![limiterKey(known)]);
  console.log("resend: per-address day cap, cooldown, stored keys passed");
}

async function resendGlobal() {
  const w = resendWorld();
  for (let i = 0; i < RESEND_GLOBAL_PER_HOUR; i++) {
    const r = await handleResendVerification({ email: `user${i}@example.com` }, w.deps);
    assert.equal(r.status, 200, `address ${i}`);
  }
  const r = await handleResendVerification({ email: "one-more@example.com" }, w.deps);
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: "rate_limited" }]);
  assert.ok(r.retryAfterSec && r.retryAfterSec <= 3600);
  // An hour later the ceiling frees up.
  w.clock.now += 60 * MIN;
  assert.equal((await handleResendVerification({ email: "later@example.com" }, w.deps)).status, 200);
  console.log("resend: global hourly ceiling passed");
}

async function resendNoExistenceLeak() {
  // Same status + body for: unknown, unverified (sent), already verified, send failure.
  const users = {
    "unverified@example.com": { id: "u1", emailVerified: false },
    "verified@example.com": { id: "u2", emailVerified: true },
    "failing@example.com": { id: "u3", emailVerified: false },
  };
  const w = resendWorld(users);
  const answers = [];
  for (const email of ["nobody@example.com", "unverified@example.com", "verified@example.com"]) {
    answers.push(await handleResendVerification({ email }, w.deps));
  }
  w.state.sendFails = true;
  answers.push(await handleResendVerification({ email: "failing@example.com" }, w.deps));
  for (const a of answers) {
    assert.deepEqual([a.status, a.body, a.retryAfterSec], [200, { ok: true }, undefined]);
  }
  // Cooldown and day cap: same answer for an unknown and a known address.
  w.state.sendFails = false;
  const cdUnknown = await handleResendVerification({ email: "nobody@example.com" }, w.deps);
  const cdKnown = await handleResendVerification({ email: "unverified@example.com" }, w.deps);
  assert.equal(cdUnknown.status, 429);
  assert.deepEqual(Object.keys(cdUnknown.body).sort(), Object.keys(cdKnown.body).sort());
  assert.equal(cdUnknown.body.error, cdKnown.body.error);
  for (let i = 0; i < RESEND_PER_ADDRESS_PER_DAY; i++) {
    w.clock.now += MIN;
    await handleResendVerification({ email: "nobody@example.com" }, w.deps);
    await handleResendVerification({ email: "unverified@example.com" }, w.deps);
  }
  w.clock.now += MIN;
  const capUnknown = await handleResendVerification({ email: "nobody@example.com" }, w.deps);
  const capKnown = await handleResendVerification({ email: "unverified@example.com" }, w.deps);
  assert.deepEqual([capUnknown.status, capUnknown.body], [429, { ok: false, error: "rate_limited" }]);
  assert.deepEqual([capKnown.status, capKnown.body], [429, { ok: false, error: "rate_limited" }]);

  // Invalid address → 400 invalid_email, and it counts nothing.
  for (const body of [{}, { email: "" }, { email: "no-at-sign" }, { email: 42 }, null, "x"]) {
    const r = await handleResendVerification(body, w.deps);
    assert.deepEqual([r.status, r.body], [400, { ok: false, error: "invalid_email" }]);
  }
  // Limiter down → fail closed, neutral.
  const down = { ...w.deps, consume: async () => { throw new Error("connection refused DATABASE_URL"); } };
  const r = await handleResendVerification({ email: "x@example.com" }, down);
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: "rate_limited" }]);

  for (const a of [...answers, cdUnknown, cdKnown, capUnknown, capKnown, r]) {
    neutral(a.body);
    if (a.body.error) assert.ok((VERIFICATION_ERRORS as readonly string[]).includes(a.body.error as string));
  }
  console.log("resend: no existence leak, neutral answers passed");
}

// ── Signup ────────────────────────────────────────────────────────────────
function signupWorld(existing: Record<string, { passwordHash: string }> = {}) {
  const lim = fakeLimiter();
  const created: { email: string; locale: string }[] = [];
  const sent: string[] = [];
  const deps: SignupDeps = {
    consume: lim.consume,
    findUser: async (email) => existing[email] ?? (created.some((c) => c.email === email) ? { passwordHash: "h" } : null),
    hashPassword: async (p) => `hash:${p.length}`,
    provision: async ({ email, locale }) => {
      created.push({ email, locale });
      return { id: `u${created.length}` };
    },
    createCode: async () => ({ ok: true, code: "1234" }),
    send: async (to) => {
      sent.push(to);
      return { ok: true };
    },
    log: async () => {},
  };
  return { ...lim, created, sent, deps };
}
const signup = (deps: SignupDeps, email: string, ip: string, password = "longenough") =>
  signupWithEmail({ email, password, locale: "fr", ip }, deps);

async function signupCases() {
  // A normal signup is unchanged: one tenant, one email, ok.
  const w = signupWorld({ "taken@example.com": { passwordHash: "x" }, "google@example.com": { passwordHash: "" } });
  const ok = await signup(w.deps, " New@Example.com ", "203.0.113.7");
  assert.deepEqual(ok, { ok: true, email: "new@example.com", userId: "u1" });
  assert.deepEqual(w.created, [{ email: "new@example.com", locale: "fr" }]);
  assert.deepEqual(w.sent, ["new@example.com"]);
  // Existing outcomes unchanged.
  assert.deepEqual(await signup(w.deps, "taken@example.com", "203.0.113.8"), { ok: false, error: "exists" });
  assert.deepEqual(await signup(w.deps, "google@example.com", "203.0.113.8"), { ok: false, error: "exists_google" });
  assert.deepEqual(await signup(w.deps, "bad", "203.0.113.8"), { ok: false, error: "invalid" });
  assert.deepEqual(await signup(w.deps, "short@example.com", "203.0.113.8", "short"), { ok: false, error: "invalid" });
  assert.equal(w.created.length, 1);

  // The 6th from one IP in an hour → refused: no tenant, no email.
  const v = signupWorld();
  for (let i = 0; i < SIGNUP_PER_IP_PER_HOUR; i++) {
    assert.equal((await signup(v.deps, `ip${i}@example.com`, "198.51.100.1")).ok, true, `signup #${i + 1}`);
  }
  assert.deepEqual(await signup(v.deps, "sixth@example.com", "198.51.100.1"), { ok: false, error: "rate_limited" });
  assert.equal(v.created.length, SIGNUP_PER_IP_PER_HOUR);
  assert.equal(v.sent.length, SIGNUP_PER_IP_PER_HOUR);
  assert.ok(!v.created.some((c) => c.email === "sixth@example.com"));
  // Another IP is not affected; an hour later the first IP frees up.
  assert.equal((await signup(v.deps, "other@example.com", "198.51.100.2")).ok, true);
  v.clock.now += 60 * MIN;
  assert.equal((await signup(v.deps, "sixth@example.com", "198.51.100.1")).ok, true);
  // Stored keys: sha256 of the IP, never the IP.
  for (const k of Object.keys(v.ledgers.get("signup")!)) {
    assert.match(k, /^[0-9a-f]{64}$/);
  }
  assert.ok(v.ledgers.get("signup")![limiterKey("198.51.100.1")]);

  // Global hourly ceiling → refused from a fresh IP.
  const g = signupWorld();
  for (let i = 0; i < SIGNUP_GLOBAL_PER_HOUR; i++) {
    assert.equal((await signup(g.deps, `g${i}@example.com`, `192.0.2.${i}`)).ok, true);
  }
  assert.deepEqual(await signup(g.deps, "late@example.com", "192.0.2.250"), { ok: false, error: "rate_limited" });
  assert.equal(g.created.length, SIGNUP_GLOBAL_PER_HOUR);
  assert.equal(g.sent.length, SIGNUP_GLOBAL_PER_HOUR);

  // Concurrency on one IP: 20 parallel → exactly 5 tenants (atomicity proven
  // on real Postgres in verification-limits-db.test.ts).
  const c = signupWorld();
  const many = await Promise.all(Array.from({ length: 20 }, (_, i) => signup(c.deps, `p${i}@example.com`, "198.51.100.9")));
  assert.equal(many.filter((o) => o.ok).length, SIGNUP_PER_IP_PER_HOUR);
  assert.equal(c.created.length, SIGNUP_PER_IP_PER_HOUR);

  // Limiter down → fail closed, nothing created.
  const down = signupWorld();
  down.deps.consume = async () => { throw new Error("db down"); };
  assert.deepEqual(await signup(down.deps, "x@example.com", "198.51.100.3"), { ok: false, error: "rate_limited" });
  assert.equal(down.created.length, 0);
  console.log("signup: per-IP cap, global ceiling, unchanged normal path passed");
}

// ── Static guards on the wiring ───────────────────────────────────────────
function wiring() {
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const page = code("app/[locale]/signup/page.tsx");
  assert.match(page, /clientIp\(await headers\(\)\)/, "signup reads the client IP like the repo's other caps");
  assert.match(page, /signupWithEmail\(/);
  assert.doesNotMatch(page, /provisionTenant|sendVerificationEmail/, "signup only creates accounts through the capped path");
  const route = code("app/api/auth/resend-verification/route.ts");
  assert.match(route, /handleResendVerification\(body, resendDeps\)/);
  assert.doesNotMatch(route, /sendVerificationEmail|createEmailVerification/);
  for (const l of ["fr", "en", "he"]) {
    const m = JSON.parse(readFileSync(`messages/${l}.json`, "utf8"));
    assert.ok(m.Signup.errRateLimited, `${l} Signup.errRateLimited`);
    assert.ok(m.VerifyEmail.errResendRateLimited, `${l} VerifyEmail.errResendRateLimited`);
  }
  assert.match(readFileSync("app/[locale]/signup/signup-content.tsx", "utf8"), /rate_limited: t\("errRateLimited"\)/);
  console.log("wiring passed");
}

async function main() {
  await resendCases();
  await resendGlobal();
  await resendNoExistenceLeak();
  await signupCases();
  wiring();
  console.log("ALL VERIFICATION-LIMITS TESTS PASSED");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
