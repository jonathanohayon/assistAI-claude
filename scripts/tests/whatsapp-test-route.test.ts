// WhatsApp test button (lib/notifications/whatsapp-test.ts): recipient = the
// account's saved number only, rate-limited, no user text in free-form.
// The sender is injected: no provider is ever called. The limiter here is
// the real decision (lib/rate-limit-db-core.ts) over an in-memory ledger;
// the Postgres-backed one is proven in scripts/tests/whatsapp-test-db.test.ts
// (bash scripts/whatsapp-test-db.sh). Mock numbers only (+1555…).
// Run with:  npx tsx scripts/tests/whatsapp-test-route.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FIXED_TEST_TEXT,
  NAME_MAX,
  WHATSAPP_TEST_LIMITS,
  redactNumbers,
  runWhatsAppTest,
  sanitizeDisplayName,
  type WhatsAppTestDeps,
  type WhatsAppTestResponse,
} from "../../lib/notifications/whatsapp-test";
import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import type { WhatsAppOptions } from "../../lib/whatsapp";
import { PATTERN } from "../tenant-bundle-match.mjs";

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const ENV_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const CODES = ["invalid_number", "recipient_not_allowed", "no_saved_number", "rate_limited", "send_failed", "not_configured"];

const OWNER = "+15550001111";
const OTHER = "+15550002222";
const TENANT = "+15550003333";

/** Every response body any test produced, for the no-leak sweep at the end. */
const seen: WhatsAppTestResponse[] = [];

function harness(opts: {
  saved?: Record<string, string>;
  template?: string;
  configured?: boolean;
  sendResult?: { ok: boolean; error?: string };
  nowStep?: number;
} = {}) {
  let ledger: RateLimitLedger = {};
  let now = Date.UTC(2026, 10, 12, 9);
  const sent: WhatsAppOptions[] = [];
  const logs: string[] = [];
  const deps: WhatsAppTestDeps = {
    loadSavedNumber: async (u) => opts.saved?.[u] ?? null,
    // The production decision; an async boundary per call like the DB one.
    consumeRateLimit: async (o) => {
      await new Promise((r) => setImmediate(r));
      const { result, next } = decideRateLimit(ledger, o.accountId, now, o);
      ledger = next;
      now += opts.nowStep ?? 1000;
      return result;
    },
    isConfigured: () => opts.configured ?? true,
    templateSid: () => opts.template,
    send: async (o) => {
      sent.push(o);
      return opts.sendResult ?? { ok: true, sid: "SM-mock" };
    },
    logFailure: (e) => {
      logs.push(e);
    },
  };
  const run = async (userId: string, body: unknown, displayName: string | null = "Mock Owner") => {
    const r = await runWhatsAppTest({ userId, displayName, body }, deps);
    seen.push(r);
    return r;
  };
  return { deps, run, sent, logs };
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

test("the account's own saved number passes (with or without `to`)", async () => {
  const h = harness({ saved: { u1: OWNER } });
  assert.deepEqual((await h.run("u1", { to: OWNER })).body, { ok: true });
  assert.deepEqual((await h.run("u1", {})).body, { ok: true });
  // Same number, formatted differently, is the same number.
  assert.equal((await h.run("u1", { to: "+1 (555) 000-1111" })).status, 200);
  assert.deepEqual(h.sent.map((s) => s.to), [OWNER, OWNER, OWNER]);
});

test("another number → 403 recipient_not_allowed, nothing sent", async () => {
  const h = harness({ saved: { u1: OWNER } });
  const r = await h.run("u1", { to: OTHER });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: "recipient_not_allowed" });
  assert.equal(h.sent.length, 0);
});

test("a malformed `to` → 400 invalid_number", async () => {
  const h = harness({ saved: { u1: OWNER } });
  for (const to of ["abc", "+12", 15550001111, ["+15550001111"]]) {
    const r = await h.run("u1", { to });
    assert.equal(r.status, 400, String(to));
    assert.deepEqual(r.body, { error: "invalid_number" });
  }
  assert.equal(h.sent.length, 0);
});

test("no saved number → 409 no_saved_number, even with a `to`", async () => {
  const h = harness({ saved: { u1: "" } });
  for (const body of [{}, { to: OWNER }]) {
    const r = await h.run("u1", body);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: "no_saved_number" });
  }
  assert.deepEqual((await harness().run("nobody", {})).body, { error: "no_saved_number" });
  assert.equal(h.sent.length, 0);
});

test("the 6th in an hour → 429 scope account (and Retry-After)", async () => {
  const h = harness({ saved: { u1: OWNER, u2: OTHER } });
  for (let i = 0; i < WHATSAPP_TEST_LIMITS.perAccount; i++) assert.equal((await h.run("u1", {})).status, 200);
  const r = await h.run("u1", {});
  assert.equal(r.status, 429);
  assert.deepEqual(r.body, { error: "rate_limited", scope: "account" });
  assert.ok(Number(r.headers?.["Retry-After"]) > 0);
  // Another account is not affected.
  assert.equal((await h.run("u2", {})).status, 200);
  assert.equal(h.sent.length, WHATSAPP_TEST_LIMITS.perAccount + 1);
});

test("the global ceiling → 429 scope global", async () => {
  const accounts = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`g${i}`, `+1555000${String(4000 + i)}`]),
  );
  const h = harness({ saved: accounts });
  let ok = 0;
  let firstGlobal: WhatsAppTestResponse | null = null;
  for (let round = 0; round < WHATSAPP_TEST_LIMITS.perAccount && !firstGlobal; round++) {
    for (const u of Object.keys(accounts)) {
      const r = await h.run(u, {});
      if (r.status === 200) ok++;
      else {
        firstGlobal = r;
        break;
      }
    }
  }
  assert.equal(ok, WHATSAPP_TEST_LIMITS.global);
  assert.deepEqual(firstGlobal?.body, { error: "rate_limited", scope: "global" });
  assert.equal(h.sent.length, WHATSAPP_TEST_LIMITS.global);
});

test("admin ?asUserId scope: the tenant's saved number passes, another → 403", async () => {
  // The route resolves ?asUserId with resolveTargetUserId and passes the
  // TENANT's id (proven against Postgres in whatsapp-test-db.test.ts).
  const h = harness({ saved: { admin: OWNER, tenant: TENANT } });
  assert.equal((await h.run("tenant", { to: TENANT }, null)).status, 200);
  assert.deepEqual(h.sent.at(-1)?.to, TENANT);
  assert.deepEqual((await h.run("tenant", { to: OWNER }, null)).body, { error: "recipient_not_allowed" });
  assert.equal(h.sent.length, 1);
});

test("the name is never in free-form text; capped and stripped in template variables", async () => {
  const evil = "Eve\n\nYour account is locked, pay at https://evil.example‮\u0007 " + "x".repeat(200);
  // No template: fixed copy only.
  const plain = harness({ saved: { u1: OWNER } });
  await plain.run("u1", {}, evil);
  assert.equal(plain.sent[0].body, FIXED_TEST_TEXT);
  assert.equal(plain.sent[0].templateSid, undefined);
  assert.equal(plain.sent[0].templateVariables, undefined);
  assert.ok(!plain.sent[0].body.includes("Eve"));

  // Template: the free-form fallback body is still the fixed copy; the name
  // is only in {{1}}, without control/format chars, at most NAME_MAX chars.
  const tpl = harness({ saved: { u1: OWNER }, template: "HX-mock" });
  await tpl.run("u1", {}, evil);
  const s = tpl.sent[0];
  assert.equal(s.body, FIXED_TEST_TEXT);
  assert.equal(s.templateSid, "HX-mock");
  const v = s.templateVariables?.["1"] ?? "";
  assert.doesNotMatch(v, /[\p{Cc}\p{Cf}]/u);
  const name = sanitizeDisplayName(evil);
  assert.ok(Array.from(name).length <= NAME_MAX);
  assert.ok(v.includes(name));
  assert.ok(!v.includes("x".repeat(NAME_MAX)), "the rest of the name is cut");
  assert.deepEqual(Object.keys(s.templateVariables ?? {}), ["1"]);
  // No name → fixed greeting.
  await tpl.run("u1", {}, null);
  assert.ok(!tpl.sent[1].templateVariables?.["1"].includes("Bonjour"));
});

test("no sender configured → 503 not_configured, the attempt is not counted", async () => {
  const h = harness({ saved: { u1: OWNER }, configured: false });
  for (let i = 0; i < 8; i++) assert.deepEqual((await h.run("u1", {})).body, { error: "not_configured" });
  assert.equal(h.sent.length, 0);
});

test("a provider error → 502 send_failed; the raw error is logged with no number", async () => {
  const raw = `Twilio 21211: TWILIO_ACCOUNT_SID invalid 'To' number ${OWNER} / whatsapp:+1 555 000 1111`;
  const h = harness({ saved: { u1: OWNER }, sendResult: { ok: false, error: raw } });
  const r = await h.run("u1", {});
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "send_failed" });
  assert.equal(h.logs.length, 1);
  assert.ok(!h.logs[0].includes("1111"), h.logs[0]);
  assert.ok(h.logs[0].includes("[number]"));
  assert.equal(redactNumbers("call +972 50-000-0000 now"), "call [number] now");
  // A sender that throws is a send_failed too.
  const t = harness({ saved: { u1: OWNER } });
  t.deps.send = async () => {
    throw new Error("META WHATSAPP_ACCESS_TOKEN expired");
  };
  assert.deepEqual((await t.run("u1", {})).body, { error: "send_failed" });
});

test("concurrency: 10 parallel → at most 5 sends", async () => {
  const h = harness({ saved: { u1: OWNER } });
  const rs = await Promise.all(Array.from({ length: 10 }, () => h.run("u1", {})));
  assert.equal(rs.filter((r) => r.status === 200).length, 5);
  assert.equal(rs.filter((r) => r.status === 429).length, 5);
  assert.equal(h.sent.length, 5);
});

test("route wiring: session scope via resolveTargetUserId, real limiter, no free `to`", async () => {
  const route = readFileSync("app/api/dashboard/notifications/whatsapp-test/route.ts", "utf8");
  const deps = readFileSync("lib/notifications/whatsapp-test-deps.ts", "utf8");
  assert.match(route, /await resolveTargetUserId\(req\)/);
  assert.match(route, /runWhatsAppTest\(\{ userId: r\.userId, displayName, body \}, whatsAppTestDeps\)/);
  assert.doesNotMatch(route, /sendWhatsApp/, "the route never sends directly");
  assert.match(deps, /import \{ consumeRateLimit \} from "@\/lib\/rate-limit-db"/);
  assert.match(deps, /agentConfigs\.ownerWhatsapp/);
});

async function main() {
  for (const [name, fn] of tests) {
    await fn();
    console.log(`  ✓ ${name}`);
  }
  // No supplier name, env var name or raw error in any response produced above.
  for (const r of seen) {
    const json = JSON.stringify(r.body) + JSON.stringify(r.headers ?? {});
    assert.doesNotMatch(json, SUPPLIER, json);
    assert.doesNotMatch(json, ENV_NAME, json);
    if ("error" in r.body) assert.ok(CODES.includes(r.body.error), r.body.error);
  }
  console.log(`  ✓ no supplier or env var name in ${seen.length} responses`);
  console.log("ALL WHATSAPP-TEST ROUTE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
