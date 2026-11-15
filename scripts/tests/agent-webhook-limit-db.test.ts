// The public agent webhook (app/api/v1/agent/[token]/route.ts) against a
// THROWAWAY Postgres: real token resolution, real tenant lookup, real shared
// ledger (lib/rate-limit-db.ts). The LLM is a stub on globalThis.fetch that
// only answers the provider URL with a canned reply and refuses anything
// else: nothing leaves the machine, the key is a dummy set in-process.
//
// 1. Byte-for-byte: every response under the limits equals the PREVIOUS
//    route's (copied from main into .tmp/ by the .sh), same DB, same stub.
// 2. Limits on the real ledger: per IP (token guessing), per token, global,
//    under concurrency.
// 3. Nothing sensitive stored: the ledger rows hold no token and no IP.
//
// Skipped in a plain `npm test`. Run with:
//   bash scripts/agent-webhook-limit-db.sh
// (local Postgres on 127.0.0.1:55497, sets AGENT_WEBHOOK_LIMIT_DB_URL).
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.com, documentation IP ranges).

import assert from "node:assert/strict";

const url = process.env.AGENT_WEBHOOK_LIMIT_DB_URL;
if (!url) {
  console.log("SKIPPED agent-webhook-limit-db (set AGENT_WEBHOOK_LIMIT_DB_URL — see scripts/agent-webhook-limit-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;

const LLM_URL = "https://api.openai.com/v1/chat/completions";
let llmCalls = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (target !== LLM_URL) throw new Error(`test refuses network access to ${target}`);
  llmCalls++;
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
  const last = body.messages[body.messages.length - 1];
  const reply = last.role === "system" ? "Welcome, this is the mock agent." : `Mock answer to: ${last.content}`;
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

type Handler = (req: unknown, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
interface Route {
  GET: Handler;
  POST: Handler;
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { generateAgentToken } = await import("../../lib/agent-tokens");
  const policy = await import("../../lib/agent-webhook/policy");
  const next = (await import("../../app/api/v1/agent/[token]/route")) as unknown as Route;
  // Written by the .sh only (git-ignored): a variable path keeps tsc off it.
  const prevPath = "../../.tmp/agent-webhook-main/route";
  const prev = (await import(prevPath)) as unknown as Route;

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await exec(q)) as unknown as unknown[] | { rows: unknown[] };
    return (Array.isArray(r) ? r : r.rows) as Record<string, unknown>[];
  };
  const resetLedgers = () => exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:agent_webhook_%'`);

  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  await exec(sql`DELETE FROM users`);
  for (const [id, n] of [[A, "a"], [B, "b"]] as const) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${id}, ${`tenant-${n}@example.com`}, 'x', 'user')`);
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, agent_name, primary_language)
      VALUES (${id}, 'You are a mock receptionist for a mock salon.', 'Greet.', ${`Mock ${n}`}, 'fr')`);
  }
  const tokenA = (await generateAgentToken(A)).token;
  const tokenB = (await generateAgentToken(B)).token;
  const unknownToken = `agt_${"0".repeat(36)}`;

  const call = (route: Route, method: "GET" | "POST", token: string, ip: string, body?: string) =>
    route[method](
      new NextRequest(`http://localhost/api/v1/agent/${token}`, {
        method,
        headers: { "x-real-ip": ip, "content-type": "application/json" },
        ...(body === undefined ? {} : { body }),
      }),
      { params: Promise.resolve({ token }) },
    );
  const snap = async (r: Response) => ({ status: r.status, type: r.headers.get("content-type"), body: await r.text() });

  // ---- 1. Byte-for-byte against the previous route -------------------------
  type Case = [label: string, method: "GET" | "POST", token: string, body?: string];
  const turn = (o: unknown) => JSON.stringify(o);
  const noKeyCases: Case[] = [
    ["GET valid", "GET", tokenA],
    ["GET unknown", "GET", unknownToken],
    ["GET malformed", "GET", "not-a-token"],
    ["POST unknown", "POST", unknownToken, turn({ transcript: "hi" })],
    ["POST bad JSON", "POST", tokenA, "not json"],
    ["POST no key → stall", "POST", tokenA, turn({ transcript: "hello", language: "he" })],
  ];
  const modelCases: Case[] = [
    ["POST greeting (model)", "POST", tokenA, turn({ call_id: "c1", turn_id: "t0", language: "en" })],
    ["POST greeting (cached)", "POST", tokenA, turn({ call_id: "c2", turn_id: "t0", language: "en" })],
    ["POST greeting default language", "POST", tokenB, turn({ call_id: "c3", turn_id: "t0" })],
    [
      "POST turn with history",
      "POST",
      tokenA,
      turn({
        call_id: "c1",
        turn_id: "t1",
        language: "fr",
        transcript: "Je voudrais un rendez-vous",
        history: [{ role: "agent", text: "Bonjour" }, { role: "caller", text: "Bonjour" }, { text: 3 }],
      }),
    ],
  ];
  const compare = async (cases: Case[]) => {
    for (const [label, method, token, body] of cases) {
      const before = llmCalls;
      const old = await snap(await call(prev, method, token, "203.0.113.5", body));
      const oldCalls = llmCalls - before;
      const now = await snap(await call(next, method, token, "203.0.113.5", body));
      assert.deepEqual(now, old, `${label}: response must be byte-identical to the previous route`);
      assert.equal(llmCalls - before - oldCalls, oldCalls, `${label}: same number of LLM calls`);
    }
  };
  await resetLedgers();
  await compare(noKeyCases);
  process.env.OPENAI_API_KEY = "mock-key-not-a-real-credential";
  await compare(modelCases);
  assert.ok(llmCalls > 0, "the model path was exercised");
  delete process.env.OPENAI_API_KEY;

  // ---- 2. Limits on the real ledger -----------------------------------------
  const expect429 = async (r: Response, scope: string, msg: string) => {
    assert.equal(r.status, 429, msg);
    assert.equal(await r.text(), JSON.stringify({ error: "rate_limited", scope }), msg);
    const ra = Number(r.headers.get("retry-after"));
    assert.ok(Number.isInteger(ra) && ra >= 1, `${msg}: Retry-After`);
  };

  // Per IP: concurrent unknown-token guessing from one address.
  await resetLedgers();
  {
    const guesses = await Promise.all(
      Array.from({ length: policy.AGENT_WEBHOOK_GET_PER_IP + 20 }, (_, i) =>
        call(next, "GET", `agt_${i.toString(16).padStart(36, "1")}`, "198.51.100.66"),
      ),
    );
    assert.equal(guesses.filter((r) => r.status === 404).length, policy.AGENT_WEBHOOK_GET_PER_IP, "exactly the IP budget");
    const limited = guesses.filter((r) => r.status === 429);
    assert.equal(limited.length, 20);
    await expect429(limited[0], "ip", "guessing from one IP");
    await expect429(await call(next, "GET", tokenA, "198.51.100.66"), "ip", "valid token from a blocked IP");
    assert.equal((await call(next, "GET", tokenA, "198.51.100.67")).status, 200, "another IP is fine");
  }

  // Per token: concurrent POST turns from distinct IPs, no key (no LLM call).
  await resetLedgers();
  {
    const body = turn({ transcript: "hi", language: "en" });
    const res = await Promise.all(
      Array.from({ length: policy.AGENT_WEBHOOK_POST_PER_TOKEN + 15 }, (_, i) =>
        call(next, "POST", tokenA, `192.0.2.${i + 1}`, body),
      ),
    );
    assert.equal(res.filter((r) => r.status === 200).length, policy.AGENT_WEBHOOK_POST_PER_TOKEN, "exactly the token budget");
    const limited = res.filter((r) => r.status === 429);
    assert.equal(limited.length, 15);
    await expect429(limited[0], "token", "POST per token");
    // Regenerating the URL does not reset the count: it is keyed by tenant.
    const regenerated = (await generateAgentToken(A)).token;
    await expect429(await call(next, "POST", regenerated, "192.0.2.250", body), "token", "after regenerate");
    assert.equal((await call(next, "POST", tokenB, "192.0.2.251", body)).status, 200, "another tenant is fine");
    assert.equal((await call(next, "GET", regenerated, "192.0.2.252")).status, 200, "GET is a separate bucket");
  }

  // Global ceiling: guesses spread over many IPs, concurrently in chunks.
  await resetLedgers();
  {
    const total = policy.AGENT_WEBHOOK_GET_GLOBAL;
    for (let done = 0; done < total; ) {
      const n = Math.min(50, total - done);
      const res = await Promise.all(
        Array.from({ length: n }, (_, i) => {
          const k = done + i;
          return call(next, "GET", `agt_${k.toString(16).padStart(36, "2")}`, `10.${k % 250}.${Math.floor(k / 250)}.1`);
        }),
      );
      assert.ok(res.every((r) => r.status === 404), "under the ceiling");
      done += n;
    }
    await expect429(await call(next, "GET", tokenB, "172.16.0.1"), "global", "global ceiling");
  }

  // ---- 3. Nothing sensitive stored -----------------------------------------
  {
    await call(next, "POST", tokenB, "203.0.113.77", turn({ transcript: "hi" }));
    const ledgers = await rows(sql`SELECT key, value FROM app_settings WHERE key LIKE 'rate_limit:agent_webhook_%'`);
    assert.ok(ledgers.length >= 2);
    const dump = JSON.stringify(ledgers);
    for (const needle of ["agt_", tokenA, tokenB, "203.0.113", "198.51.100", "192.0.2.", "10.0.0.1"]) {
      assert.ok(!dump.includes(needle), "ledger must hold no token and no IP");
    }
    for (const row of ledgers) {
      const ids = Object.keys(JSON.parse(String(row.value)) as Record<string, unknown>);
      const ok = String(row.key).endsWith("_ip")
        ? ids.every((id) => /^[0-9a-f]{64}$/.test(id))
        : ids.every((id) => id === A || id === B);
      assert.ok(ok, `${String(row.key)}: account ids are hashes or tenant ids only`);
    }
    const events = await rows(sql`SELECT count(*)::int AS n FROM events WHERE event = 'agent_webhook_rate_limit_failed'`);
    assert.equal(Number(events[0].n), 0, "no limiter failure logged");
  }

  console.log("ALL AGENT-WEBHOOK-LIMIT DB TESTS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
