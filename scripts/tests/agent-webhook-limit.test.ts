// Shared rate limit of the public agent webhook (lib/agent-webhook/handler.ts)
// with every I/O faked: the limiter runs the REAL decision
// (lib/rate-limit-db-core.ts decideRateLimit) over an in-memory ledger, the
// LLM is a stub. Nothing reaches a network. The real ledger, real token
// resolution and the byte-for-byte comparison with the previous route run in
// scripts/agent-webhook-limit-db.sh.
// Run with:  npx tsx scripts/tests/agent-webhook-limit.test.ts
// Mock data only (documentation IP ranges, example names).

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import type { AgentWebhookDeps, ConsumeRateLimitInput } from "../../lib/agent-webhook/handler";
import { handleAgentWebhookGet, handleAgentWebhookPost } from "../../lib/agent-webhook/handler";
import {
  AGENT_WEBHOOK_GET_GLOBAL,
  AGENT_WEBHOOK_GET_PER_IP,
  AGENT_WEBHOOK_GET_PER_TOKEN,
  AGENT_WEBHOOK_POST_PER_TOKEN,
  AGENT_WEBHOOK_POST_WINDOW_MS,
} from "../../lib/agent-webhook/policy";
import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import type { ResolvedTenant } from "../../lib/tenant";

const TOKEN_A = `agt_${"a".repeat(36)}`;
const TOKEN_A2 = `agt_${"c".repeat(36)}`; // same tenant, after a regenerate
const TOKEN_B = `agt_${"b".repeat(36)}`;
const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

const tenant = (id: string): ResolvedTenant =>
  ({
    user: { id },
    config: { agentName: "Mock Agent", instructions: "You are a mock receptionist.", primaryLanguage: "en" },
  }) as unknown as ResolvedTenant;

interface World {
  deps: AgentWebhookDeps;
  ledgers: Map<string, RateLimitLedger>;
  llmCalls: number;
  clock: { now: number };
}

function world(opts: { consumeThrows?: boolean; key?: string } = {}): World {
  const ledgers = new Map<string, RateLimitLedger>();
  const clock = { now: 1_700_000_000_000 };
  const w: World = { ledgers, llmCalls: 0, clock, deps: undefined as unknown as AgentWebhookDeps };
  w.deps = {
    resolveToken: async (t) => (t === TOKEN_A || t === TOKEN_A2 ? TENANT_A : t === TOKEN_B ? TENANT_B : null),
    resolveTenant: async (id) => tenant(id),
    consume: async (input: ConsumeRateLimitInput) => {
      if (opts.consumeThrows) throw new Error("mock db down");
      const { result, next } = decideRateLimit(ledgers.get(input.bucket) ?? {}, input.accountId, clock.now, input);
      ledgers.set(input.bucket, next);
      return result;
    },
    openaiKey: () => opts.key,
    fetch: (async (url: string | URL | Request) => {
      w.llmCalls++;
      assert.equal(String(url), "https://api.openai.com/v1/chat/completions", "only the stubbed LLM endpoint");
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello from the mock." } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    logLimiterError: () => {},
  };
  return w;
}

const req = (method: "GET" | "POST", token: string, ip: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/agent/${token}`, {
    method,
    headers: { "x-real-ip": ip, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (w: World, token: string, ip = "203.0.113.1") => handleAgentWebhookGet(req("GET", token, ip), token, w.deps);
const post = (w: World, token: string, ip = "203.0.113.1", body: unknown = { transcript: "hi", language: "en" }) =>
  handleAgentWebhookPost(req("POST", token, ip, body), token, w.deps);

async function expect429(res: Response, scope: string, msg: string) {
  assert.equal(res.status, 429, msg);
  assert.deepEqual(await res.json(), { error: "rate_limited", scope }, msg);
  const ra = Number(res.headers.get("retry-after"));
  assert.ok(Number.isInteger(ra) && ra >= 1, `${msg}: Retry-After`);
}

async function main() {
  // Under the limit: the exact bytes the previous route produced.
  {
    const w = world();
    const g = await get(w, TOKEN_A);
    assert.equal(g.status, 200);
    assert.equal(
      await g.text(),
      '{"ok":true,"service":"tamara-agent","agent":"Mock Agent","contract":"POST { call_id, turn_id, language, transcript, history[] } -> { reply }","languages":["en","fr","he"]}',
    );
    const u = await get(w, `agt_${"f".repeat(36)}`);
    assert.equal(u.status, 404);
    assert.equal(await u.text(), '{"error":"Unknown agent."}');
    const p = await post(w, TOKEN_A);
    assert.equal(p.status, 200);
    assert.equal(await p.text(), '{"reply":"One moment, let me check that for you.","source":"fallback"}', "no key → stall");
    const bad = await handleAgentWebhookPost(
      new NextRequest(`http://localhost/api/v1/agent/${TOKEN_A}`, { method: "POST", body: "not json" }),
      TOKEN_A,
      w.deps,
    );
    assert.equal(bad.status, 400);
    assert.equal(await bad.text(), '{"error":"Expected a JSON body."}');
  }
  {
    const w = world({ key: "mock-key" });
    const p = await post(w, TOKEN_A);
    assert.equal(await p.text(), '{"reply":"Hello from the mock.","source":"model","language":"en"}');
    assert.equal(w.llmCalls, 1);
  }

  // Per token: 429 "token" once the tenant's budget is spent, from many IPs.
  {
    const w = world();
    for (let i = 0; i < AGENT_WEBHOOK_GET_PER_TOKEN; i++) {
      assert.equal((await get(w, TOKEN_A, `198.51.100.${i % 200}`)).status, 200);
    }
    await expect429(await get(w, TOKEN_A, "192.0.2.77"), "token", "GET per token");
    // Regenerating the URL does not reset the count (keyed by tenant).
    await expect429(await get(w, TOKEN_A2, "192.0.2.78"), "token", "GET per token after regenerate");
    // Another tenant is unaffected; POST is a separate bucket.
    assert.equal((await get(w, TOKEN_B, "192.0.2.79")).status, 200);
    assert.equal((await post(w, TOKEN_A, "192.0.2.80")).status, 200);
  }
  {
    const w = world({ key: "mock-key" });
    for (let i = 0; i < AGENT_WEBHOOK_POST_PER_TOKEN; i++) {
      assert.equal((await post(w, TOKEN_A, `198.51.100.${i}`)).status, 200);
    }
    const calls = w.llmCalls;
    await expect429(await post(w, TOKEN_A, "192.0.2.1"), "token", "POST per token");
    assert.equal(w.llmCalls, calls, "a limited turn never reaches the LLM");
    // The window rolls: allowed again a window later.
    w.clock.now += AGENT_WEBHOOK_POST_WINDOW_MS;
    assert.equal((await post(w, TOKEN_A, "192.0.2.1")).status, 200);
  }

  // Per IP: unknown-token guessing from one address is cut with 429 "ip".
  {
    const w = world();
    for (let i = 0; i < AGENT_WEBHOOK_GET_PER_IP; i++) {
      const guess = `agt_${i.toString(16).padStart(36, "0")}`;
      assert.equal((await get(w, guess, "203.0.113.9")).status, 404);
    }
    await expect429(await get(w, `agt_${"e".repeat(36)}`, "203.0.113.9"), "ip", "guessing from one IP");
    // Even a valid token is refused from that address, before resolution.
    await expect429(await get(w, TOKEN_A, "203.0.113.9"), "ip", "valid token from a blocked IP");
    // Another address is fine.
    assert.equal((await get(w, TOKEN_A, "203.0.113.10")).status, 200);
  }

  // Global ceiling: many IPs, many guesses → 429 "global".
  {
    const w = world();
    let n = 0;
    for (let ip = 0; n < AGENT_WEBHOOK_GET_GLOBAL; ip++) {
      for (let k = 0; k < AGENT_WEBHOOK_GET_PER_IP && n < AGENT_WEBHOOK_GET_GLOBAL; k++, n++) {
        assert.equal((await get(w, `agt_${n.toString(16).padStart(36, "0")}`, `10.0.${ip}.1`)).status, 404);
      }
    }
    await expect429(await get(w, TOKEN_A, "192.0.2.200"), "global", "global ceiling");
  }

  // Concurrency (serialised by the fake like the DB row lock does): exactly the budget gets through.
  {
    const w = world();
    const res = await Promise.all(
      Array.from({ length: AGENT_WEBHOOK_POST_PER_TOKEN + 15 }, (_, i) => post(w, TOKEN_A, `198.51.100.${i}`)),
    );
    assert.equal(res.filter((r) => r.status === 200).length, AGENT_WEBHOOK_POST_PER_TOKEN);
    assert.equal(res.filter((r) => r.status === 429).length, 15);
  }

  // Limiter down → 503, fails closed, nothing resolved, no LLM call.
  {
    const w = world({ consumeThrows: true, key: "mock-key" });
    let resolved = 0;
    w.deps.resolveToken = async () => {
      resolved++;
      return TENANT_A;
    };
    for (const r of [await get(w, TOKEN_A), await post(w, TOKEN_A)]) {
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { error: "unavailable" });
    }
    assert.equal(resolved, 0);
    assert.equal(w.llmCalls, 0);
  }

  // Nothing sensitive in the ledgers: no raw token, no IP, only hashes / tenant ids.
  {
    const w = world();
    await get(w, TOKEN_A, "203.0.113.42");
    await post(w, TOKEN_A, "203.0.113.42");
    await get(w, `agt_${"9".repeat(36)}`, "203.0.113.43");
    const dump = JSON.stringify([...w.ledgers]);
    for (const secret of [TOKEN_A, "agt_", "203.0.113", "9".repeat(36)]) {
      assert.ok(!dump.includes(secret), `ledger must not contain ${secret.slice(0, 8)}`);
    }
    for (const [bucket, ledger] of w.ledgers) {
      for (const id of Object.keys(ledger)) {
        assert.ok(
          bucket.endsWith("_ip") ? /^[0-9a-f]{64}$/.test(id) : id === TENANT_A,
          `${bucket}: unexpected account id shape`,
        );
      }
    }
    assert.deepEqual([...w.ledgers.keys()].sort(), [
      "agent_webhook_get_ip",
      "agent_webhook_get_token",
      "agent_webhook_post_ip",
      "agent_webhook_post_token",
    ]);
  }

  console.log("ALL AGENT-WEBHOOK-LIMIT TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
