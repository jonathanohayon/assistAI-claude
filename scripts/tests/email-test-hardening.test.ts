// POST /api/dashboard/notifications/email-test hardening (lib/email-test/*):
// own address only, per-account + global rate limits counted before sending,
// neutral error codes. Every I/O is injected: nothing is ever sent, no DB.
// The real ledger under concurrency: scripts/tests/email-test-hardening-db.test.ts.
// Mock data only (example.com).
// Run with:  npx tsx scripts/tests/email-test-hardening.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import type { LogEvent } from "../../lib/logger";
import { handleEmailTest, type EmailTestDeps, type EmailTestSendResult } from "../../lib/email-test/handler";
import {
  EMAIL_TEST_ERRORS,
  EMAIL_TEST_GLOBAL_LIMIT,
  EMAIL_TEST_PER_ACCOUNT_LIMIT,
  EMAIL_TEST_WINDOW_MS,
  allowedTestRecipients,
  matchAllowedRecipient,
  sanitizeProviderError,
} from "../../lib/email-test/policy";
import { decideRateLimit, type RateLimitLedger as EmailTestLedger } from "../../lib/rate-limit-db-core";
import { PATTERN } from "../tenant-bundle-match.mjs";

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
// Supplier names (+ the email supplier, deliberately absent from PATTERN) and
// anything shaped like an env var name.
const LEAK = /resend|[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|FROM|SECRET|TOKEN|URL)\b/;

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const ACCOUNTS: Record<string, { loginEmail: string; displayName: string | null; role: string }> = {
  [TENANT]: { loginEmail: "Owner@Example.com", displayName: "Salon A", role: "user" },
  [OTHER]: { loginEmail: "other@example.com", displayName: null, role: "user" },
  [ADMIN]: { loginEmail: "admin@example.com", displayName: "Admin", role: "admin" },
};
const RAW_PROVIDER_ERROR =
  "Resend: domain not verified, check EMAIL_FROM / RESEND_API_KEY=re_FAKE_secret_0123456789 for owner@example.com";

function makeWorld(opts: { session: string | null; sendResult?: EmailTestSendResult; claim?: EmailTestDeps["claim"] }) {
  let ledger: EmailTestLedger = {};
  let clock = 1_800_000_000_000;
  const sent: string[] = [];
  const logs: LogEvent[] = [];
  const deps: EmailTestDeps = {
    // Mirrors resolveTargetUserId + resolveScopeUserId.
    resolveTarget: async (req) => {
      if (!opts.session) return { unauthorized: true };
      const as = req.nextUrl.searchParams.get("asUserId");
      if (!as || as === opts.session) return { userId: opts.session };
      return ACCOUNTS[opts.session]?.role === "admin" ? { userId: as } : { forbidden: true };
    },
    loadAccount: async (id) => {
      const a = ACCOUNTS[id];
      return a ? { loginEmail: a.loginEmail, displayName: a.displayName } : null;
    },
    claim:
      opts.claim ??
      // Same decision as lib/rate-limit-db.ts, in memory, on the test clock.
      (async (userId) => {
        const { result, next } = decideRateLimit(ledger, userId, clock, {
          windowMs: EMAIL_TEST_WINDOW_MS,
          perAccount: EMAIL_TEST_PER_ACCOUNT_LIMIT,
          global: EMAIL_TEST_GLOBAL_LIMIT,
        });
        ledger = next;
        return result;
      }),
    send: async (to) => {
      sent.push(to);
      return opts.sendResult ?? { ok: true, id: `msg-${sent.length}` };
    },
    log: async (ev) => {
      logs.push(ev);
    },
    secrets: () => ["re_FAKE_secret_0123456789"],
  };
  const responses: string[] = [];
  const post = async (body: unknown, query = "", raw?: string) => {
    const req = new NextRequest(`http://localhost/api/dashboard/notifications/email-test${query}`, {
      method: "POST",
      body: raw ?? JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
    const res = await handleEmailTest(req, deps);
    const text = await res.text();
    responses.push(text);
    return { status: res.status, json: JSON.parse(text) as Record<string, unknown>, retryAfter: res.headers.get("retry-after") };
  };
  return {
    deps,
    post,
    now: () => clock,
    sent,
    logs,
    responses,
    tick: (ms: number) => {
      clock += ms;
    },
    setLedger: (l: EmailTestLedger) => {
      ledger = l;
    },
  };
}

const allResponses: string[] = [];
const allLogs: LogEvent[] = [];

async function main() {
  // 1. Own login address passes (normalised: trim + lowercase on both sides).
  {
    const w = makeWorld({ session: TENANT });
    const r = await w.post({ to: "  owner@EXAMPLE.com " });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, id: "msg-1" }, "200 keeps { ok, id } and drops fallback");
    assert.deepEqual(w.sent, ["owner@example.com"]);
    allResponses.push(...w.responses);
    allLogs.push(...w.logs);
  }

  // 2. Another address → 403 recipient_not_allowed, nothing sent, nothing counted.
  {
    const w = makeWorld({ session: TENANT });
    for (const to of ["victim@example.com", "other@example.com", "admin@example.com", "owner@example.com.evil.example"]) {
      const r = await w.post({ to });
      assert.equal(r.status, 403, to);
      assert.deepEqual(r.json, { error: "recipient_not_allowed" }, to);
    }
    assert.equal(w.sent.length, 0);
    // Rejected recipients don't eat the quota: 5 own sends still pass.
    for (let i = 0; i < EMAIL_TEST_PER_ACCOUNT_LIMIT; i++) assert.equal((await w.post({ to: "owner@example.com" })).status, 200);
    allResponses.push(...w.responses);
  }

  // 3. The 6th in an hour → 429 scope account; the window rolls.
  {
    const w = makeWorld({ session: TENANT });
    for (let i = 0; i < EMAIL_TEST_PER_ACCOUNT_LIMIT; i++) {
      assert.equal((await w.post({ to: "owner@example.com" })).status, 200, `send ${i + 1}`);
      w.tick(60_000);
    }
    const sixth = await w.post({ to: "owner@example.com" });
    assert.equal(sixth.status, 429);
    assert.deepEqual(sixth.json, { error: "rate_limited", scope: "account" });
    assert.equal(sixth.retryAfter, String((EMAIL_TEST_WINDOW_MS - EMAIL_TEST_PER_ACCOUNT_LIMIT * 60_000) / 1000), "Retry-After = when the oldest slot frees");
    assert.equal(w.sent.length, EMAIL_TEST_PER_ACCOUNT_LIMIT, "the 6th is not sent");
    // Another account is not affected.
    const wOther = makeWorld({ session: OTHER });
    assert.equal((await wOther.post({ to: "other@example.com" })).status, 200);
    // One hour after the first send, one slot frees up.
    w.tick(EMAIL_TEST_WINDOW_MS - EMAIL_TEST_PER_ACCOUNT_LIMIT * 60_000);
    assert.equal((await w.post({ to: "owner@example.com" })).status, 200, "rolling window frees the oldest slot");
    assert.equal((await w.post({ to: "owner@example.com" })).status, 429);
    allResponses.push(...w.responses, ...wOther.responses);
  }

  // 4. The global ceiling → 429 scope global (many accounts can't add up to a relay).
  {
    const w = makeWorld({ session: TENANT });
    const full: EmailTestLedger = {};
    const now = w.now();
    for (let i = 0; i < EMAIL_TEST_GLOBAL_LIMIT; i++) {
      (full[`acct-${i % 20}`] ??= []).push(now - 1000 - i);
    }
    w.setLedger(full);
    const r = await w.post({ to: "owner@example.com" });
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: "rate_limited", scope: "global" });
    assert.equal(w.sent.length, 0);
    allResponses.push(...w.responses);
  }

  // 5. Admin: ?asUserId=<tenant> to the tenant's own address passes; to any other → 403.
  {
    const w = makeWorld({ session: ADMIN });
    const ok = await w.post({ to: "owner@example.com" }, `?asUserId=${TENANT}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(w.sent, ["owner@example.com"]);
    for (const to of ["admin@example.com", "victim@example.com"]) {
      const r = await w.post({ to }, `?asUserId=${TENANT}`);
      assert.equal(r.status, 403, to);
      assert.deepEqual(r.json, { error: "recipient_not_allowed" });
    }
    // Unknown tenant → nothing is allowed.
    const ghost = await w.post({ to: "owner@example.com" }, "?asUserId=00000000-0000-4000-8000-00000000dead");
    assert.deepEqual([ghost.status, ghost.json], [403, { error: "recipient_not_allowed" }]);
    // A non-admin can't use asUserId at all.
    const wTenant = makeWorld({ session: OTHER });
    const f = await wTenant.post({ to: "owner@example.com" }, `?asUserId=${TENANT}`);
    assert.deepEqual([f.status, f.json], [403, { error: "forbidden" }]);
    assert.equal(wTenant.sent.length, 0);
    allResponses.push(...w.responses, ...wTenant.responses);
  }

  // 6. Missing or malformed address (or body) → 400 invalid_email.
  {
    const w = makeWorld({ session: TENANT });
    for (const body of [{}, { to: "" }, { to: "   " }, { to: "owner" }, { to: "owner@example" }, { to: 42 }, { to: ["owner@example.com"] }, null, []]) {
      const r = await w.post(body);
      assert.deepEqual([r.status, r.json], [400, { error: "invalid_email" }], JSON.stringify(body));
    }
    const bad = await w.post(undefined, "", "{not json");
    assert.deepEqual([bad.status, bad.json], [400, { error: "invalid_email" }]);
    assert.equal(w.sent.length, 0);
    allResponses.push(...w.responses);
    // No session → 401.
    const anon = makeWorld({ session: null });
    const r = await anon.post({ to: "owner@example.com" });
    assert.deepEqual([r.status, r.json], [401, { error: "unauthorized" }]);
    allResponses.push(...anon.responses);
  }

  // 7. Provider failure / not configured / ledger down → neutral 500; raw error only in the log, redacted.
  {
    const w = makeWorld({ session: TENANT, sendResult: { ok: false, error: RAW_PROVIDER_ERROR } });
    const r = await w.post({ to: "owner@example.com" });
    assert.deepEqual([r.status, r.json], [500, { error: "send_failed" }]);
    const failed = w.logs.find((l) => l.event === "email_test_failed");
    assert.ok(failed, "provider error is logged server-side");
    const logged = JSON.stringify(failed);
    assert.match(logged, /domain not verified/, "the raw error text is kept for ops");
    assert.doesNotMatch(logged, /owner@example\.com/i, "no recipient address in the log");
    assert.doesNotMatch(logged, /re_FAKE_secret/, "no secret in the log");
    allResponses.push(...w.responses);
    allLogs.push(...w.logs);

    const thrower = makeWorld({ session: TENANT });
    thrower.deps.send = async () => {
      throw new Error(RAW_PROVIDER_ERROR);
    };
    const t = await thrower.post({ to: "owner@example.com" });
    assert.deepEqual([t.status, t.json], [500, { error: "send_failed" }]);
    allResponses.push(...thrower.responses);
    allLogs.push(...thrower.logs);

    const unconfigured = makeWorld({ session: TENANT, sendResult: { ok: true, fallback: "console_log" } });
    const u = await unconfigured.post({ to: "owner@example.com" });
    assert.deepEqual([u.status, u.json], [500, { error: "not_configured" }]);
    allResponses.push(...unconfigured.responses);
    allLogs.push(...unconfigured.logs);

    const ledgerDown = makeWorld({
      session: TENANT,
      claim: async () => {
        throw new Error("connection refused");
      },
    });
    const d = await ledgerDown.post({ to: "owner@example.com" });
    assert.deepEqual([d.status, d.json], [500, { error: "send_failed" }], "fails closed when the ledger is down");
    assert.equal(ledgerDown.sent.length, 0);
    allResponses.push(...ledgerDown.responses);
    allLogs.push(...ledgerDown.logs);
  }

  // 8. No response contains a supplier name, env var name, raw provider error or non-neutral code.
  assert.ok(allResponses.length > 30);
  for (const text of allResponses) {
    assert.doesNotMatch(text, SUPPLIER, text);
    assert.doesNotMatch(text, LEAK, text);
    assert.ok(!text.includes("domain not verified"), text);
    const j = JSON.parse(text) as { error?: string; scope?: string };
    if (j.error !== undefined) assert.ok((EMAIL_TEST_ERRORS as readonly string[]).includes(j.error), `code ${j.error}`);
    if (j.scope !== undefined) assert.ok(["account", "global"].includes(j.scope));
    assert.ok(!("hint" in j) && !("fallback" in j), text);
  }
  // No log event ever carries an address.
  for (const l of allLogs) assert.doesNotMatch(JSON.stringify(l), /@example\.com/i, l.event);

  // 9. Pure pieces.
  assert.deepEqual(allowedTestRecipients({ loginEmail: " Owner@Example.COM " }), ["owner@example.com"]);
  assert.deepEqual(allowedTestRecipients({ loginEmail: "not-an-address" }), []);
  assert.equal(matchAllowedRecipient("OWNER@example.com", { loginEmail: "owner@example.com" }), "owner@example.com");
  assert.equal(matchAllowedRecipient("x@example.com", { loginEmail: "owner@example.com" }), null);
  {
    const now = 10 * EMAIL_TEST_WINDOW_MS;
    const rule = { windowMs: EMAIL_TEST_WINDOW_MS, perAccount: EMAIL_TEST_PER_ACCOUNT_LIMIT, global: EMAIL_TEST_GLOBAL_LIMIT };
    // Account limit is checked before the global one.
    const both: EmailTestLedger = { u: Array(EMAIL_TEST_PER_ACCOUNT_LIMIT).fill(now - 1) };
    for (let i = 0; i < EMAIL_TEST_GLOBAL_LIMIT; i++) (both[`x${i}`] ??= []).push(now - 1);
    const v = decideRateLimit(both, "u", now, rule).result;
    assert.ok(!v.ok && v.scope === "account");
  }
  assert.equal(
    sanitizeProviderError("bad to: <owner@example.com>, key re_FAKE_secret_0123456789", ["re_FAKE_secret_0123456789"]),
    "bad to: <[address]>, key [secret]",
  );
  assert.ok(sanitizeProviderError("x".repeat(1000)).length <= 301);

  console.log("ALL EMAIL-TEST-HARDENING TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
