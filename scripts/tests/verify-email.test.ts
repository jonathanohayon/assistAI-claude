// POST /api/auth/verify-email: lib/verification-limits/verify.ts with fake
// deps. In-memory limiter built on the real decision (decideRateLimit) with a
// fake clock. The real-Postgres part (real limiter under concurrency, real
// users / email_verifications rows, real bcrypt) is
// scripts/tests/verify-email-db.test.ts. Nothing here sends an email.
// The 4-case gate rule does not apply: this route has no admin-gated field.
// Run with:  npx tsx scripts/tests/verify-email.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { LogEvent } from "../../lib/logger";
import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import {
  limiterKey,
  VERIFICATION_ERRORS,
  VERIFY_ADDRESS_BUCKET,
  VERIFY_GLOBAL_BUCKET,
  VERIFY_GLOBAL_PER_HOUR,
  VERIFY_IP_BUCKET,
  VERIFY_PER_ADDRESS_PER_HOUR,
  VERIFY_PER_IP_PER_HOUR,
} from "../../lib/verification-limits/policy";
import { handleVerifyEmail, type VerifyDeps } from "../../lib/verification-limits/verify";
import type { VerifyResult } from "../../lib/verify-code";

const HOUR = 3_600_000;

// Mock accounts (example.com only). The correct code for each is "1234".
type FakeUser = { id: string; emailVerified: boolean; codeState: "active" | "none" | "expired" | "exhausted" };
const ACCOUNTS: Record<string, FakeUser> = {
  "unverified@example.com": { id: "u-unverified", emailVerified: false, codeState: "active" },
  "nocode@example.com": { id: "u-nocode", emailVerified: false, codeState: "none" },
  "expired@example.com": { id: "u-expired", emailVerified: false, codeState: "expired" },
  "exhausted@example.com": { id: "u-exhausted", emailVerified: false, codeState: "exhausted" },
  "verified@example.com": { id: "u-verified", emailVerified: true, codeState: "active" },
};
const GOOD = "1234";

function world() {
  const ledgers = new Map<string, RateLimitLedger>();
  const clock = { now: 1_000_000_000 };
  const logs: LogEvent[] = [];
  const calls = { findUser: 0, compares: 0 };
  const verifiedNow = new Set<string>();
  const users = structuredClone(ACCOUNTS);
  const deps: VerifyDeps = {
    consume: async ({ bucket, accountId, windowMs, perAccount, global }) => {
      const { result, next } = decideRateLimit(ledgers.get(bucket) ?? {}, accountId, clock.now, { windowMs, perAccount, global });
      ledgers.set(bucket, next);
      return result;
    },
    findUser: async (email) => {
      calls.findUser++;
      const u = users[email];
      return u ? { id: u.id, emailVerified: u.emailVerified } : null;
    },
    verifyCode: async (userId, code): Promise<VerifyResult> => {
      calls.compares++;
      const u = Object.values(users).find((x) => x.id === userId)!;
      if (u.codeState === "none") return { ok: false, reason: "no_code" };
      if (u.codeState === "expired") return { ok: false, reason: "expired" };
      if (u.codeState === "exhausted") return { ok: false, reason: "max_attempts" };
      if (code !== GOOD) return { ok: false, reason: "wrong_code", attemptsLeft: 4 };
      u.emailVerified = true;
      verifiedNow.add(userId);
      return { ok: true };
    },
    matchesLatestCode: async (_userId, code) => {
      calls.compares++;
      return code === GOOD;
    },
    burnCompare: async () => {
      calls.compares++;
    },
    log: async (ev) => {
      logs.push(ev);
    },
  };
  return { ledgers, clock, logs, calls, deps, users, verifiedNow };
}

const hdrs = (init: Record<string, string> = { "x-real-ip": "203.0.113.7" }) => new Headers(init);
const call = (w: ReturnType<typeof world>, email: unknown, code: unknown, headers = hdrs()) =>
  handleVerifyEmail({ body: { email, code }, headers }, w.deps);
const bytes = (r: { status: number; body: unknown; retryAfterSec?: number }) =>
  JSON.stringify([r.status, r.body, r.retryAfterSec ?? null]);

async function main() {
  // ── Neutral answer ────────────────────────────────────────────────────────
  {
    const cases: Array<[string, string, string]> = [
      ["unknown address", "nobody@example.com", "1111"],
      ["unknown address, the right digits", "nobody@example.com", GOOD],
      ["existing unverified, wrong code", "unverified@example.com", "1111"],
      ["existing unverified, no active code", "nocode@example.com", GOOD],
      ["existing unverified, expired code", "expired@example.com", GOOD],
      ["existing unverified, tries exhausted", "exhausted@example.com", GOOD],
      ["existing verified, wrong code", "verified@example.com", "1111"],
      ["malformed code", "unverified@example.com", "12a4"],
      ["missing code", "unverified@example.com", ""],
    ];
    const seen = new Set<string>();
    for (const [label, email, code] of cases) {
      const w = world();
      const r = await call(w, email, code);
      seen.add(bytes(r));
      assert.equal(bytes(r), JSON.stringify([400, { ok: false, error: "invalid_code" }, null]), label);
      assert.equal(w.calls.compares, 1, `${label}: exactly one bcrypt compare`);
      assert.equal(w.verifiedNow.size, 0, `${label}: nothing verified`);
    }
    assert.equal(seen.size, 1, "every non-success outcome is byte-identical");
    console.log("ok neutral: unknown / wrong / no code / expired / exhausted / verified-wrong / malformed → identical bytes");
  }

  // Case and spaces in the address do not change the answer.
  {
    const w = world();
    const a = await call(w, "  Nobody@Example.com ", "1111");
    const b = await call(world(), "unverified@example.com", "1111");
    assert.equal(bytes(a), bytes(b));
  }

  // ── Success ───────────────────────────────────────────────────────────────
  {
    const w = world();
    const r = await call(w, "unverified@example.com", GOOD);
    assert.equal(bytes(r), JSON.stringify([200, { ok: true }, null]));
    assert.ok(w.verifiedNow.has("u-unverified"), "the account is marked verified");
    assert.equal(w.calls.compares, 1);
    assert.ok(w.logs.some((l) => l.event === "verify_success" && l.userId === "u-unverified"));
    // A second submit of the same code (now verified) gets the same success bytes.
    const again = await call(w, "unverified@example.com", GOOD);
    assert.equal(bytes(again), bytes(r));
    // Already verified + correct code → the success answer, nothing new learned.
    const v = await call(world(), "verified@example.com", GOOD);
    assert.equal(bytes(v), bytes(r));
    console.log("ok success: correct code → 200 { ok: true }; already verified + correct code → same bytes");
  }

  // ── Bad request (no account state involved) ───────────────────────────────
  for (const email of [undefined, "", "no-at-sign", 42]) {
    const w = world();
    const r = await call(w, email, GOOD);
    assert.deepEqual([r.status, r.body], [400, { ok: false, error: "invalid_request" }]);
    assert.equal(w.calls.findUser, 0);
  }
  {
    const w = world();
    const r = await handleVerifyEmail({ body: null, headers: hdrs() }, w.deps);
    assert.deepEqual(r.body, { ok: false, error: "invalid_request" });
  }

  // ── Limits ────────────────────────────────────────────────────────────────
  const LIMITED = JSON.stringify([429, { ok: false, error: "rate_limited" }]);
  const limited = (r: { status: number; body: unknown; retryAfterSec?: number }) => {
    assert.equal(JSON.stringify([r.status, r.body]), LIMITED);
    assert.ok(typeof r.retryAfterSec === "number" && r.retryAfterSec > 0 && r.retryAfterSec <= 3600, "Retry-After");
  };

  // Per IP: 10/h from one IP across many addresses, then 429, before any lookup.
  {
    const w = world();
    for (let i = 0; i < VERIFY_PER_IP_PER_HOUR; i++) {
      assert.equal((await call(w, `ip-${i}@example.com`, "1111", hdrs({ "x-real-ip": "198.51.100.1" }))).status, 400);
    }
    const lookups = w.calls.findUser;
    limited(await call(w, "unverified@example.com", GOOD, hdrs({ "x-real-ip": "198.51.100.1" })));
    limited(await call(w, "nobody@example.com", GOOD, hdrs({ "x-real-ip": "198.51.100.1" })));
    assert.equal(w.calls.findUser, lookups, "a limited request never reaches the account lookup");
    // Another IP is unaffected.
    assert.equal((await call(w, "unverified@example.com", GOOD, hdrs({ "x-real-ip": "198.51.100.2" }))).status, 200);
    // The window passes.
    w.clock.now += HOUR;
    assert.equal((await call(w, "nobody@example.com", "1111", hdrs({ "x-real-ip": "198.51.100.1" }))).status, 400);
    console.log("ok per-IP limit");
  }

  // Per address: 10/h for one address across many IPs; same 429 bytes whether
  // or not the address has an account.
  for (const addr of ["unverified@example.com", "nobody@example.com"]) {
    const w = world();
    for (let i = 0; i < VERIFY_PER_ADDRESS_PER_HOUR; i++) {
      assert.equal((await call(w, addr, "1111", hdrs({ "x-real-ip": `192.0.2.${i + 1}` }))).status, 400);
    }
    const r = await call(w, addr, GOOD, hdrs({ "x-real-ip": "192.0.2.200" }));
    limited(r);
    assert.equal(w.verifiedNow.size, 0, "even the right code is refused once over the limit");
    // Address normalisation: a case variant shares the bucket.
    limited(await call(w, addr.toUpperCase(), GOOD, hdrs({ "x-real-ip": "192.0.2.201" })));
    // Another address is unaffected.
    assert.equal((await call(w, "other@example.com", "1111", hdrs({ "x-real-ip": "192.0.2.202" }))).status, 400);
  }
  console.log("ok per-address limit (same answer for existing and unknown)");

  // Global ceiling: once reached, a fresh IP + fresh address is refused.
  {
    const w = world();
    const now = w.clock.now;
    w.ledgers.set(VERIFY_GLOBAL_BUCKET, { all: Array(VERIFY_GLOBAL_PER_HOUR).fill(now) });
    const r = await call(w, "fresh@example.com", GOOD, hdrs({ "x-real-ip": "203.0.113.99" }));
    limited(r);
    assert.equal(w.calls.findUser, 0);
    console.log("ok global ceiling");
  }

  // Concurrency (in memory): 30 parallel tries on one address → exactly 10 pass
  // the limits. The real-DB version is in verify-email-db.test.ts.
  {
    const w = world();
    const rs = await Promise.all(
      Array.from({ length: 30 }, (_, i) => call(w, "unverified@example.com", "1111", hdrs({ "x-real-ip": `192.0.2.${i + 1}` }))),
    );
    assert.equal(rs.filter((r) => r.status === 400).length, VERIFY_PER_ADDRESS_PER_HOUR);
    assert.equal(rs.filter((r) => r.status === 429).length, 30 - VERIFY_PER_ADDRESS_PER_HOUR);
  }

  // Limiter down → fail closed, same neutral 429, no lookup.
  {
    const w = world();
    w.deps.consume = async () => {
      throw new Error("db down");
    };
    const r = await call(w, "unverified@example.com", GOOD);
    limited(r);
    assert.equal(w.calls.findUser, 0);
    assert.ok(w.logs.some((l) => l.event === "verify_limiter_failed"));
  }

  // ── Client IP: X-Real-IP first, then the first X-Forwarded-For entry ─────
  {
    const ipKeyAfter = async (init: Record<string, string>) => {
      const w = world();
      await call(w, "nobody@example.com", "1111", new Headers(init));
      return Object.keys(w.ledgers.get(VERIFY_IP_BUCKET) ?? {});
    };
    assert.deepEqual(await ipKeyAfter({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.9, 10.0.0.1" }), [
      limiterKey("203.0.113.5"),
    ]);
    assert.deepEqual(await ipKeyAfter({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }), [limiterKey("198.51.100.9")]);
    assert.deepEqual(await ipKeyAfter({}), [limiterKey("unknown")]);
    console.log("ok client IP: X-Real-IP, then first X-Forwarded-For entry");
  }

  // ── No address (and no IP) in clear in limiter rows or logs ───────────────
  {
    const w = world();
    const addrs = ["unverified@example.com", "nobody@example.com", "verified@example.com", "nocode@example.com"];
    for (const a of addrs) {
      await call(w, a, "1111", hdrs({ "x-real-ip": "203.0.113.44" }));
      await call(w, a, GOOD, hdrs({ "x-real-ip": "203.0.113.44" }));
    }
    const stored = JSON.stringify([...w.ledgers.entries()]);
    assert.doesNotMatch(stored, /@|example|unverified|nobody|203\.0\.113/, stored);
    assert.deepEqual(Object.keys(w.ledgers.get(VERIFY_ADDRESS_BUCKET) ?? {}).sort(), addrs.map(limiterKey).sort());
    for (const k of Object.keys(w.ledgers.get(VERIFY_IP_BUCKET) ?? {})) assert.match(k, /^[0-9a-f]{64}$/);
    const logged = JSON.stringify(w.logs);
    assert.ok(w.logs.length > 0);
    assert.doesNotMatch(logged, /@|example\.com|203\.0\.113/, logged);
    assert.doesNotMatch(logged, /1234/, "no code in logs");
    console.log("ok no address in limiter rows or logs");
  }

  // ── Response codes are the listed neutral ones ────────────────────────────
  {
    const src = readFileSync("lib/verification-limits/verify.ts", "utf8");
    for (const m of src.matchAll(/fail\("([a-z_]+)"/g)) {
      assert.ok((VERIFICATION_ERRORS as readonly string[]).includes(m[1]), `non-neutral code ${m[1]}`);
    }
    assert.equal([...src.matchAll(/\bbody: \{/g)].length, 2, "responses are built by fail() and VERIFIED only");
    const route = readFileSync("app/api/auth/verify-email/route.ts", "utf8");
    assert.match(route, /handleVerifyEmail\(\{ body, headers: req\.headers \}, verifyDeps\)/);
    assert.doesNotMatch(route, /alreadyVerified|Aucun compte|attemptsLeft/);
    // The form maps the neutral codes (no raw server text shown).
    const form = readFileSync("app/[locale]/verify-email/verify-form.tsx", "utf8");
    assert.match(form, /"invalid_code"/);
    assert.match(form, /"rate_limited"/);
    for (const l of ["fr", "en", "he"]) {
      const m = JSON.parse(readFileSync(`messages/${l}.json`, "utf8")).VerifyEmail;
      assert.ok(m.errInvalidCode && m.errVerifyRateLimited, `${l} messages`);
    }
  }

  console.log("ALL VERIFY-EMAIL TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
