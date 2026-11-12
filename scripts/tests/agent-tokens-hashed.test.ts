// Agent webhook tokens are stored hashed and shown once (lib/agent-tokens.ts).
// Part 1 runs everywhere, against an in-memory store with the same semantics
// as the Postgres one. Part 2 needs a THROWAWAY Postgres and skips in a plain
// `npm test`; run it with:  bash scripts/agent-tokens-db.sh
// (127.0.0.1:55452; only a local URL is accepted, DATABASE_URL is never read).
// Mock tokens only.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  agentTokenHint,
  generateAgentToken,
  getAgentTokenStatus,
  hashAgentToken,
  resolveAgentToken,
  revokeAgentToken,
  type AgentTokenEntry,
  type AgentTokenMap,
  type AgentTokenStore,
} from "../../lib/agent-tokens";

const ROOT = new URL("../../", import.meta.url).pathname;

/** In-memory store: same contract as pgAgentTokenStore. */
function memoryStore(initial: AgentTokenMap = {}) {
  let map: AgentTokenMap = structuredClone(initial);
  const store: AgentTokenStore = {
    async read() {
      return structuredClone(map);
    },
    async replaceForUser(userId, hash, entry) {
      map = Object.fromEntries(Object.entries(map).filter(([, e]) => e.userId !== userId));
      map[hash] = entry;
    },
    async removeForUser(userId) {
      map = Object.fromEntries(Object.entries(map).filter(([, e]) => e.userId !== userId));
    },
    async migrateLegacy(plain, hash, hint) {
      if (!map[plain]) return;
      const e = map[plain];
      delete map[plain];
      map[hash] = { ...e, hint };
    },
  };
  return { store, raw: () => JSON.stringify(map), map: () => map };
}

// Mock legacy token, same format as every token ever generated (agt_ + 36 hex).
const LEGACY = "agt_" + "0123456789abcdef0123456789abcdef0a1b";
const legacyEntry: AgentTokenEntry = { userId: "user-legacy", createdAt: "2026-07-01T00:00:00.000Z" };

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

test("a new token authenticates and its plain form is absent from the stored value", async () => {
  const m = memoryStore();
  const { token, hint } = await generateAgentToken("user-a", m.store);
  assert.match(token, /^agt_[0-9a-f]{36}$/, "keeps the agt_ prefix");
  assert.equal(await resolveAgentToken(token, m.store), "user-a");
  assert.equal(await resolveAgentToken(`  ${token}\n`, m.store), "user-a", "trimmed");
  assert.ok(!m.raw().includes(token), "plain token not stored");
  assert.ok(!m.raw().includes(token.slice(4)), "not even without the prefix");
  assert.ok(m.raw().includes(hashAgentToken(token)), "stored under its sha256");
  assert.equal(hint, agentTokenHint(token));
  assert.match(hint, /^agt_…[0-9a-f]{4}$/);
});

test("an existing plain (legacy) token still authenticates", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  assert.equal(await resolveAgentToken(LEGACY, m.store), "user-legacy");
  // ...and is migrated to the hashed form on that first use, keeping its metadata.
  assert.ok(!m.raw().includes(LEGACY), "legacy entry no longer stored in clear");
  assert.deepEqual(m.map()[hashAgentToken(LEGACY)], { ...legacyEntry, hint: agentTokenHint(LEGACY) });
  assert.equal(await resolveAgentToken(LEGACY, m.store), "user-legacy", "still works after migration");
});

test("a legacy token keeps working when the migration write fails", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  m.store.migrateLegacy = async () => {
    throw new Error("db down");
  };
  assert.equal(await resolveAgentToken(LEGACY, m.store), "user-legacy");
});

test("a wrong token fails", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  const { token } = await generateAgentToken("user-a", m.store);
  const wrong = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  for (const bad of [wrong, "", "agt_", "tmr_" + token.slice(4), token.slice(4), hashAgentToken(token), "agt___proto__", "__proto__", "constructor", LEGACY.slice(0, -1) + "c"]) {
    assert.equal(await resolveAgentToken(bad, m.store), null, `rejects ${JSON.stringify(bad.slice(0, 8))}…`);
  }
});

test("regenerate invalidates the old token, hashed or legacy, and keeps other tenants", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  const other = await generateAgentToken("user-b", m.store);
  const first = await generateAgentToken("user-a", m.store);
  const second = await generateAgentToken("user-a", m.store);
  assert.equal(await resolveAgentToken(first.token, m.store), null, "old hashed token dead");
  assert.equal(await resolveAgentToken(second.token, m.store), "user-a");

  const fresh = await generateAgentToken("user-legacy", m.store);
  assert.equal(await resolveAgentToken(LEGACY, m.store), null, "legacy token dead");
  assert.equal(await resolveAgentToken(fresh.token, m.store), "user-legacy");

  // Legacy migrated first, then regenerated: the hashed copy goes too.
  const m2 = memoryStore({ [LEGACY]: legacyEntry });
  await resolveAgentToken(LEGACY, m2.store);
  await generateAgentToken("user-legacy", m2.store);
  assert.equal(await resolveAgentToken(LEGACY, m2.store), null, "migrated legacy token dead");

  assert.equal(await resolveAgentToken(other.token, m.store), "user-b", "other tenant untouched");
  assert.equal(Object.values(m.map()).filter((e) => e.userId === "user-a").length, 1, "one entry per tenant");
});

test("revoke removes the token, legacy or hashed", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  const { token } = await generateAgentToken("user-a", m.store);
  await revokeAgentToken("user-a", m.store);
  await revokeAgentToken("user-legacy", m.store);
  assert.equal(await resolveAgentToken(token, m.store), null);
  assert.equal(await resolveAgentToken(LEGACY, m.store), null);
  assert.deepEqual(m.map(), {});
});

test("the status (dashboard GET) never contains the token after creation", async () => {
  const m = memoryStore({ [LEGACY]: legacyEntry });
  assert.deepEqual(await getAgentTokenStatus("nobody", m.store), { exists: false, createdAt: null, hint: null });

  const { token, createdAt } = await generateAgentToken("user-a", m.store);
  const status = await getAgentTokenStatus("user-a", m.store);
  assert.deepEqual(status, { exists: true, createdAt, hint: agentTokenHint(token) });
  assert.ok(!JSON.stringify(status).includes(token.slice(4, -4)), "no token body in the status");

  const legacy = await getAgentTokenStatus("user-legacy", m.store);
  assert.deepEqual(legacy, { exists: true, createdAt: legacyEntry.createdAt, hint: agentTokenHint(LEGACY) });
  assert.ok(!JSON.stringify(legacy).includes(LEGACY.slice(4, -4)), "no legacy token body in the status");
  assert.ok(m.raw().includes(LEGACY), "reading the status does not migrate (only a successful auth does)");
});

test("the dashboard route: GET returns the status only, POST returns the token once", async () => {
  const src = readFileSync(join(ROOT, "app/api/dashboard/agent-url/route.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const get = code.slice(code.indexOf("export async function GET"), code.indexOf("export async function POST"));
  assert.match(get, /getAgentTokenStatus\(session\.user\.id\)/);
  assert.doesNotMatch(get, /generateAgentToken|ensureAgentToken|\btoken\b/, "GET neither creates nor returns a token");
  assert.doesNotMatch(src, /ensureAgentToken/);
  const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function DELETE"));
  assert.match(post, /NextResponse\.json\(\{ token, exists: true, createdAt, hint \}\)/);
  // The token never reaches a log line.
  const logs = src.match(/logEvent\(\{[\s\S]*?\}\)/g) ?? [];
  assert.equal(logs.length, 2);
  for (const l of logs) assert.doesNotMatch(l, /\btoken\b/);
  const lib = readFileSync(join(ROOT, "lib/agent-tokens.ts"), "utf8");
  assert.doesNotMatch(lib, /console\.|logEvent/, "lib never logs");
});

// ── Part 2: throwaway Postgres ──────────────────────────────────────────────

async function dbPart(url: string) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
  process.env.DATABASE_URL = url;
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { getSetting, setSetting } = await import("../../lib/settings");
  const { AGENT_TOKENS_SETTING: KEY } = await import("../../lib/agent-tokens");

  const reset = () => db.execute(sql`DELETE FROM app_settings WHERE key = ${KEY}`);
  const raw = async () => (await getSetting(KEY)) ?? "";
  const map = async () => JSON.parse((await raw()) || "{}") as AgentTokenMap;
  const dbTests: [string, () => Promise<void>][] = [];
  const t = (n: string, f: () => Promise<void>) => dbTests.push([n, f]);

  t("db: stored shape is { sha256: { userId, createdAt, hint } }, no plain token", async () => {
    const { token, createdAt, hint } = await generateAgentToken("user-a"); // no row yet: INSERT path
    assert.deepEqual(await map(), { [hashAgentToken(token)]: { userId: "user-a", createdAt, hint } });
    assert.ok(!(await raw()).includes(token.slice(4)));
    assert.equal(await resolveAgentToken(token), "user-a");
    assert.deepEqual(await getAgentTokenStatus("user-a"), { exists: true, createdAt, hint });
  });

  t("db: a legacy plain token authenticates and is migrated in place", async () => {
    await setSetting(KEY, JSON.stringify({ [LEGACY]: legacyEntry, other: { userId: "user-b", createdAt: "x", hint: "h" } }));
    assert.equal(await resolveAgentToken(LEGACY), "user-legacy");
    const m = await map();
    assert.ok(!(await raw()).includes(LEGACY));
    assert.deepEqual(m[hashAgentToken(LEGACY)], { ...legacyEntry, hint: agentTokenHint(LEGACY) });
    assert.deepEqual(m.other, { userId: "user-b", createdAt: "x", hint: "h" });
    assert.equal(await resolveAgentToken(LEGACY), "user-legacy");
  });

  t("db: regenerate removes the legacy entry and the hashed one", async () => {
    await setSetting(KEY, JSON.stringify({ [LEGACY]: legacyEntry }));
    const a = await generateAgentToken("user-legacy");
    assert.equal(await resolveAgentToken(LEGACY), null);
    const b = await generateAgentToken("user-legacy");
    assert.equal(await resolveAgentToken(a.token), null);
    assert.equal(await resolveAgentToken(b.token), "user-legacy");
    assert.deepEqual(Object.keys(await map()), [hashAgentToken(b.token)]);
    await revokeAgentToken("user-legacy");
    assert.deepEqual(await map(), {});
  });

  t("db: corrupt stored JSON is reset, like the old reader treated it as empty", async () => {
    await setSetting(KEY, "{not json");
    const { token } = await generateAgentToken("user-a");
    assert.equal(await resolveAgentToken(token), "user-a");
  });

  t("db: 10 parallel creates for 10 tenants lose nothing", async () => {
    const users = Array.from({ length: 10 }, (_, i) => `u${i}`);
    await generateAgentToken("seed"); // row exists: every write goes through ON CONFLICT
    const res = await Promise.all(users.map((u) => generateAgentToken(u)));
    const m = await map();
    assert.equal(Object.keys(m).length, 11);
    for (const [i, r] of res.entries()) assert.equal(await resolveAgentToken(r.token), users[i]);
  });

  t("db: 10 parallel regenerates for one tenant leave exactly one valid token", async () => {
    const res = await Promise.all(Array.from({ length: 10 }, () => generateAgentToken("user-a")));
    const m = await map();
    assert.equal(Object.values(m).filter((e) => e.userId === "user-a").length, 1);
    const valid = (await Promise.all(res.map((r) => resolveAgentToken(r.token)))).filter(Boolean);
    assert.equal(valid.length, 1);
  });

  t("db: a regenerate racing a legacy migration never resurrects the legacy token", async () => {
    for (let i = 0; i < 20; i++) {
      await setSetting(KEY, JSON.stringify({ [LEGACY]: legacyEntry, keep: { userId: "user-b", createdAt: "x" } }));
      const [, fresh] = await Promise.all([resolveAgentToken(LEGACY), generateAgentToken("user-legacy")]);
      const m = await map();
      assert.equal(await resolveAgentToken(LEGACY), null, `round ${i}: legacy dead`);
      assert.equal(await resolveAgentToken(fresh.token), "user-legacy", `round ${i}: new token valid`);
      assert.equal(Object.values(m).filter((e) => e.userId === "user-legacy").length, 1, `round ${i}: one entry`);
      assert.ok(m.keep, `round ${i}: other tenant kept`);
    }
  });

  for (const [n, f] of dbTests) {
    await reset();
    await f();
    console.log(`ok   ${n}`);
  }
  await reset();
}

async function main() {
  for (const [n, f] of tests) {
    await f();
    console.log(`ok   ${n}`);
  }
  const url = process.env.AGENT_TOKENS_TEST_DATABASE_URL;
  if (!url) {
    console.log("skip: agent-tokens db part (no AGENT_TOKENS_TEST_DATABASE_URL — see scripts/agent-tokens-db.sh)");
  } else {
    await dbPart(url);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
