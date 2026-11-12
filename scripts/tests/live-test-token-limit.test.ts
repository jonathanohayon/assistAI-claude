// Dashboard live-test token (lib/live-test/*): per-account + global rate
// limits counted before signing, admin mints counted in the tenant's bucket,
// neutral errors, and an unchanged success response (same keys, same claims).
// Every I/O is injected; the token is signed with DUMMY keys (never real ones).
// The real ledger under concurrency: scripts/tests/live-test-token-limit-db.test.ts.
// Mock data only.
// Run with:  npx tsx scripts/tests/live-test-token-limit.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { handleLiveTestToken, type LiveTestDeps } from "../../lib/live-test/handler";
import { WORKER_AGENT_NAME, mintLiveTestToken } from "../../lib/live-test/mint";
import {
  LIVE_TEST_BUCKET,
  LIVE_TEST_ERRORS,
  LIVE_TEST_GLOBAL_LIMIT,
  LIVE_TEST_PER_ACCOUNT_LIMIT,
  LIVE_TEST_WINDOW_MS,
} from "../../lib/live-test/policy";
import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import { PATTERN } from "../tenant-bundle-match.mjs";

for (const k of Object.keys(process.env)) assert.ok(!k.startsWith("LIVEKIT"), "run without any signer env");

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const DUMMY = { url: "wss://mock.invalid", apiKey: "mock_key", apiSecret: "mock_secret_0123456789abcdef0123456789" };

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const AGENT = "00000000-0000-4000-8000-0000000000c3";
const ROLES: Record<string, string> = { [TENANT]: "user", [OTHER]: "user", [ADMIN]: "admin" };
const EMAILS: Record<string, string> = { [TENANT]: "owner@example.com", [OTHER]: "other@example.com", [ADMIN]: "admin@example.com" };

function makeWorld(opts: { configured?: boolean; claim?: LiveTestDeps["claim"] } = {}) {
  let ledger: RateLimitLedger = {};
  let clock = 1_800_000_000_000;
  const minted: { userId: string; testAgentId: string | null }[] = [];
  const claims: string[] = [];
  let session: string | null = TENANT;
  const deps: LiveTestDeps = {
    session: async () => (session ? { userId: session, email: EMAILS[session] ?? null } : null),
    configured: () => opts.configured ?? true,
    // Mirrors resolveScopeUserId.
    resolveScope: async (me, as) => (!as || as === me ? { userId: me } : ROLES[me] === "admin" ? { userId: as } : { forbidden: true }),
    claim:
      opts.claim ??
      // Same decision as lib/rate-limit-db.ts, in memory, on the test clock.
      (async (userId) => {
        claims.push(userId);
        const d = decideRateLimit(ledger, userId, (clock += 1000), {
          windowMs: LIVE_TEST_WINDOW_MS,
          perAccount: LIVE_TEST_PER_ACCOUNT_LIMIT,
          global: LIVE_TEST_GLOBAL_LIMIT,
        });
        ledger = d.next;
        return d.result;
      }),
    findOutboundAgent: async (agentId, userId) => (agentId === AGENT && userId === TENANT ? AGENT : null),
    mint: async (input) => {
      minted.push({ userId: input.userId, testAgentId: input.testAgentId });
      return mintLiveTestToken(DUMMY, input);
    },
    logLimiterError: async () => {},
  };
  const post = async (body?: unknown) => {
    const req = new NextRequest("http://localhost/api/live-test/token", {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await handleLiveTestToken(req, deps);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: JSON.parse(text) as Record<string, unknown> };
  };
  return {
    post,
    minted,
    claims,
    as: (id: string | null) => (session = id),
    advance: (ms: number) => (clock += ms),
  };
}

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;

async function main() {
  assert.equal(LIVE_TEST_BUCKET, "live_test");
  assert.equal(LIVE_TEST_PER_ACCOUNT_LIMIT, 20);
  assert.ok(LIVE_TEST_GLOBAL_LIMIT > LIVE_TEST_PER_ACCOUNT_LIMIT);
  assert.equal(LIVE_TEST_WINDOW_MS, 3_600_000);

  // ── Under the limit: the response and the token claims are unchanged ──────
  {
    const w = makeWorld();
    const r = await w.post();
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ["identity", "roomName", "token", "url"]);
    assert.equal(r.json.url, DUMMY.url);
    assert.match(String(r.json.roomName), new RegExp(`^livetest-${TENANT}-[0-9a-z]+$`));
    assert.match(String(r.json.identity), new RegExp(`^web-${TENANT}-[0-9a-z]{1,6}$`));
    const c = decode(String(r.json.token));
    const meta = JSON.stringify({ source: "web", userId: TENANT });
    assert.equal(c.iss, DUMMY.apiKey);
    assert.equal(c.sub, r.json.identity);
    assert.equal(c.name, "owner@example.com");
    assert.equal(c.metadata, meta);
    assert.equal(Number(c.exp) - Number(c.nbf), 15 * 60, "15-minute TTL");
    assert.deepEqual(c.video, { roomJoin: true, room: r.json.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    const agents = (c.roomConfig as { agents: { agentName: string; metadata: string }[] }).agents;
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agentName, WORKER_AGENT_NAME);
    assert.equal(agents[0].metadata, meta);
    assert.deepEqual(Object.keys(c).sort(), ["exp", "iss", "metadata", "name", "nbf", "roomConfig", "sub", "video"]);
    assert.equal(WORKER_AGENT_NAME, "appointment-agent");

    // Outbound agent of the tenant → outbound_test metadata; someone else's → inbound.
    const o = await w.post({ agentId: AGENT });
    assert.equal(decode(String(o.json.token)).metadata, JSON.stringify({ source: "outbound_test", agentId: AGENT, userId: TENANT }));
    w.as(OTHER);
    const x = await w.post({ agentId: AGENT });
    assert.equal(decode(String(x.json.token)).metadata, JSON.stringify({ source: "web", userId: OTHER }));
    assert.deepEqual(w.claims, [TENANT, TENANT, OTHER]);
  }

  // ── The 21st in an hour → 429 scope account; another account unaffected ────
  {
    const w = makeWorld();
    for (let i = 0; i < LIVE_TEST_PER_ACCOUNT_LIMIT; i++) assert.equal((await w.post()).status, 200, `#${i + 1}`);
    const r = await w.post();
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: "rate_limited", scope: "account" });
    const ra = Number(r.headers.get("retry-after"));
    assert.ok(ra >= 1 && ra <= 3600, `Retry-After ${ra}`);
    assert.equal(w.minted.length, LIVE_TEST_PER_ACCOUNT_LIMIT, "no token signed over the limit");
    w.as(OTHER);
    assert.equal((await w.post()).status, 200);
    // Rolling window: an hour later the tenant can test again.
    w.as(TENANT);
    w.advance(LIVE_TEST_WINDOW_MS);
    assert.equal((await w.post()).status, 200);
  }

  // ── Global ceiling → 429 scope global ─────────────────────────────────────
  {
    const w = makeWorld();
    const accounts = Math.ceil(LIVE_TEST_GLOBAL_LIMIT / LIVE_TEST_PER_ACCOUNT_LIMIT);
    let ok = 0;
    for (let n = 0; n < accounts && ok < LIVE_TEST_GLOBAL_LIMIT; n++) {
      const id = `00000000-0000-4000-8000-${(0x100 + n).toString(16).padStart(12, "0")}`;
      ROLES[id] = "user";
      w.as(id);
      for (let i = 0; i < LIVE_TEST_PER_ACCOUNT_LIMIT && ok < LIVE_TEST_GLOBAL_LIMIT; i++) {
        assert.equal((await w.post()).status, 200);
        ok++;
      }
    }
    w.as(TENANT);
    const r = await w.post();
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: "rate_limited", scope: "global" });
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
    assert.equal(w.minted.length, LIVE_TEST_GLOBAL_LIMIT);
  }

  // ── Admin rule: an admin's ?asUserId mints count in the TENANT's bucket ───
  {
    const w = makeWorld();
    w.as(ADMIN);
    for (let i = 0; i < 5; i++) assert.equal((await w.post({ asUserId: TENANT })).status, 200);
    assert.deepEqual(w.minted.at(-1), { userId: TENANT, testAgentId: null }, "token is for the tenant");
    assert.ok(w.claims.every((c) => c === TENANT), "counted against the tenant, not the admin");
    w.as(TENANT);
    for (let i = 0; i < LIVE_TEST_PER_ACCOUNT_LIMIT - 5; i++) assert.equal((await w.post()).status, 200);
    assert.deepEqual((await w.post()).json, { error: "rate_limited", scope: "account" }, "tenant + admin share 20");
    w.as(ADMIN);
    assert.deepEqual((await w.post({ asUserId: TENANT })).json, { error: "rate_limited", scope: "account" }, "same limit for admins");
    assert.equal((await w.post()).status, 200, "the admin's own bucket is separate");
    // Non-admin asUserId → 403, not counted, nothing signed.
    w.as(OTHER);
    const before = w.claims.length;
    const f = await w.post({ asUserId: TENANT });
    assert.equal(f.status, 403);
    assert.deepEqual(f.json, { error: "Forbidden" });
    assert.equal(w.claims.length, before);
  }

  // ── Other branches: unchanged 401/403, neutral 500/503, nothing counted ───
  {
    const w = makeWorld();
    w.as(null);
    assert.deepEqual((await w.post()).json, { error: "Unauthorized" });
    assert.equal(w.claims.length, 0);
    const nc = makeWorld({ configured: false });
    const r = await nc.post();
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "not_configured" });
    assert.equal(nc.claims.length, 0, "not counted when the signer is missing");
    const down = makeWorld({
      claim: async () => {
        throw new Error("connect ECONNREFUSED postgres://mock LIVEKIT_API_SECRET");
      },
    });
    const d = await down.post();
    assert.equal(d.status, 503);
    assert.deepEqual(d.json, { error: "unavailable" }, "fails closed, no raw error");
    assert.equal(down.minted.length, 0);
  }

  // ── Concurrency (handler level): 30 parallel → exactly 20 signed ──────────
  {
    const w = makeWorld();
    const res = await Promise.all(Array.from({ length: 30 }, () => w.post()));
    assert.equal(res.filter((r) => r.status === 200).length, LIVE_TEST_PER_ACCOUNT_LIMIT);
    assert.equal(res.filter((r) => r.status === 429).length, 30 - LIVE_TEST_PER_ACCOUNT_LIMIT);
    assert.equal(w.minted.length, LIVE_TEST_PER_ACCOUNT_LIMIT);
  }

  // ── No supplier name, env var or raw error in any non-200 body ────────────
  {
    for (const c of LIVE_TEST_ERRORS) assert.doesNotMatch(c, SUPPLIER);
    const w = makeWorld();
    const bodies: string[] = [];
    w.as(null);
    bodies.push((await w.post()).text);
    w.as(OTHER);
    bodies.push((await w.post({ asUserId: TENANT })).text);
    w.as(TENANT);
    for (let i = 0; i <= LIVE_TEST_PER_ACCOUNT_LIMIT; i++) {
      const r = await w.post();
      if (r.status !== 200) bodies.push(r.text);
    }
    bodies.push((await makeWorld({ configured: false }).post()).text);
    bodies.push((await makeWorld({ claim: async () => Promise.reject(new Error("LiveKit boom")) }).post()).text);
    assert.equal(bodies.length, 5);
    for (const b of bodies) {
      assert.doesNotMatch(b, SUPPLIER, b);
      assert.doesNotMatch(b, /[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|SECRET|URL|TOKEN)\b|boom|ECONN/, b);
      const j = JSON.parse(b) as { error: string };
      assert.ok((LIVE_TEST_ERRORS as readonly string[]).includes(j.error), j.error);
    }
  }

  console.log("ALL LIVE-TEST-TOKEN-LIMIT TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
