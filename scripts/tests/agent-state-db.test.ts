// agentState against a THROWAWAY Postgres seeded with mock accounts:
//   - the state table (to_activate / live / attention:subscription_inactive /
//     attention:config_unavailable) from the REAL inbound resolver, run dry;
//   - the dry run has no side effect: every table byte-identical before/after
//     (events, app_settings incl. the alert ledger, agent_configs forwarding
//     columns…), no fetch, no DNS lookup — while the LIVE handler on the same
//     number does write (proves the dry effects are what prevents it);
//   - the hero's other fields byte-identical to origin/main's
//     computeDashboardStats for the same accounts;
//   - timing of the dry run (printed).
// Skipped in a plain `npm test`. Run with:  bash scripts/agent-state-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (+1555… numbers, example.com).

import assert from "node:assert/strict";
import dns from "node:dns";

const url = process.env.AGENT_STATE_DB_URL;
if (!url) {
  console.log("SKIPPED agent-state-db (set AGENT_STATE_DB_URL — see scripts/agent-state-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "test-internal-secret";

// Nothing leaves the process. Every fetch and every DNS lookup is recorded
// and refused.
const network = { fetch: [] as string[], dns: [] as string[] };
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  network.fetch.push(u);
  throw new Error(`test: no network (${u})`);
}) as typeof fetch;
(dns.promises as { lookup: unknown }).lookup = async (hostname: string) => {
  network.dns.push(hostname);
  throw new Error("test: no DNS");
};

const id = (s: string) => `00000000-0000-4000-8000-${s.padStart(12, "0")}`;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { computeAgentState } = await import("../../lib/agent-state/compute");
  const { computeHeroStats } = await import("../../lib/dashboard-hero");
  const liveRoute = await import("../../app/api/agent/config/route");
  const mainStatsPath = process.env.AGENT_STATE_MAIN_STATS;
  if (!mainStatsPath) throw new Error("AGENT_STATE_MAIN_STATS not set");
  const mainStats = (await import(mainStatsPath)) as typeof import("../../lib/dashboard-stats");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = <T>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];

  // Every public table's content, hashed.
  async function fingerprint(): Promise<Record<string, string>> {
    const tables = rows<{ t: string }>(await exec(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`));
    const out: Record<string, string> = {};
    for (const { t } of tables) {
      const [r] = rows<{ h: string; n: number }>(
        await exec(sql.raw(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*)::int AS n FROM "${t}" x`)),
      );
      out[t] = `${r.n}:${r.h}`;
    }
    return out;
  }

  // ── Seed ────────────────────────────────────────────────────────────────
  const A = id("a1"); // no number → to_activate
  const B = id("b1"); // paid, number, config, open forwarding test, unreadable brain secret → live
  const C = id("c1"); // trial ended → subscription_inactive
  const C2 = id("c2"); // trial paused → subscription_inactive
  const C3 = id("c3"); // trial minutes used up → subscription_inactive
  const D = id("d1"); // paid, number, NO agent config → config_unavailable
  const E = id("e1"); // admin, trialing with no end date → live
  const F = id("f1"); // trial running, external brain url (DNS path) → live
  const NUM: Record<string, string> = {
    [B]: "+15555550101",
    [C]: "+15555550102",
    [C2]: "+15555550103",
    [C3]: "+15555550104",
    [D]: "+15555550105",
    [E]: "+15555550106",
    [F]: "+15555550107",
  };
  const DAY = 24 * 60 * 60 * 1000;
  const past = new Date(Date.now() - DAY).toISOString();
  const future = new Date(Date.now() + 7 * DAY).toISOString();
  const accounts: Array<[string, string, string, string | null, string, boolean]> = [
    // id, role, status, trialEndsAt, plan, has agent config
    [A, "user", "active", null, "global", true],
    [B, "user", "active", null, "premium", true],
    [C, "user", "trialing", past, "global", true],
    [C2, "user", "trial_paused", past, "global", true],
    [C3, "user", "trialing", future, "global", true],
    [D, "user", "active", null, "global", false],
    [E, "admin", "trialing", null, "premium", true],
    [F, "user", "trialing", future, "global", true],
  ];
  for (const [uid, role, status, ends, plan, hasConfig] of accounts) {
    await exec(sql`INSERT INTO users (id, email, password_hash, role, subscription_status, trial_ends_at, subscription_plan, display_name)
      VALUES (${uid}, ${`demo-${uid.slice(-2)}@example.com`}, 'x', ${role}, ${status}, ${ends}::timestamptz, ${plan}, 'Demo Salon')`);
    if (hasConfig) {
      await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_whatsapp, primary_language, business)
        VALUES (${uid}, 'Mock persona.', 'Mock greeting.', '+15555550199', 'fr', ${JSON.stringify({ identity: { name: "Demo Salon" } })}::jsonb)`);
    }
    if (NUM[uid]) await exec(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${uid}, ${NUM[uid]})`);
  }
  // B: an open forwarding test window (a live phone call would verify it).
  await exec(sql`UPDATE agent_configs SET forwarding_test_started_at = now() WHERE user_id = ${B}`);
  // C3: 100 min of calls (the trial cap). B: calls + bookings for the hero stats.
  await exec(sql`INSERT INTO calls (user_id, duration_seconds) VALUES (${C3}, 6000)`);
  await exec(sql`INSERT INTO calls (user_id, duration_seconds, created_at) VALUES (${B}, 95, now()), (${B}, 40, now() - interval '3 days'), (${B}, 300, now() - interval '40 days')`);
  await exec(sql`INSERT INTO calls (user_id, duration_seconds) VALUES (${F}, 120)`);
  await exec(sql`INSERT INTO events (user_id, source, event, message, created_at) VALUES
    (${B}, 'agent', 'book_success', 'mock booking', '2026-10-02T10:00:00Z'), (${B}, 'agent', 'book_success', 'mock booking', now())`);
  // External brains: B's sealed secret can't be opened (E1 reporter path);
  // F's url would need a DNS check at serve time.
  await exec(sql`INSERT INTO app_settings (key, value) VALUES ('tenant_agent_brain', ${JSON.stringify({
    [B]: { enabled: true, url: "https://brain-b.example.com/hook", secret: "enc:v1:malformed" },
    [F]: { enabled: true, url: "https://brain-f.example.com/hook" },
  })})`);

  // ── The state table (dry run) ───────────────────────────────────────────
  const expected: Record<string, unknown> = {
    [A]: { state: "to_activate", reason: null },
    [B]: { state: "live", reason: null },
    [C]: { state: "attention", reason: "subscription_inactive" },
    [C2]: { state: "attention", reason: "subscription_inactive" },
    [C3]: { state: "attention", reason: "subscription_inactive" },
    [D]: { state: "attention", reason: "config_unavailable" },
    [E]: { state: "live", reason: null },
    [F]: { state: "live", reason: null },
  };
  const before = await fingerprint();
  for (const [uid] of accounts) {
    assert.deepEqual(await computeAgentState(uid), expected[uid], `agentState of ${uid}`);
  }
  console.log("state table: to_activate / live / attention:subscription_inactive / attention:config_unavailable ok");

  // ── No side effect ──────────────────────────────────────────────────────
  // Let any fire-and-forget work settle before comparing.
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await fingerprint(), before, "the dry run writes nothing (every table identical)");
  assert.deepEqual(network, { fetch: [], dns: [] }, "the dry run makes no network call and no DNS lookup");
  const [fwd] = rows<{ v: string | null }>(await exec(sql`SELECT forwarding_verified_at AS v FROM agent_configs WHERE user_id = ${B}`));
  assert.equal(fwd.v, null, "the dry run never verifies forwarding");
  console.log("dry run: every table identical, 0 fetch, 0 DNS");

  // ── Hero: other fields byte-identical to origin/main ────────────────────
  for (const [uid] of accounts) {
    const hero = await computeHeroStats(uid);
    const { agentState, ...rest } = hero;
    assert.deepEqual(agentState, expected[uid], `hero agentState of ${uid}`);
    assert.equal(Object.keys(hero).at(-1), "agentState", "agentState is appended after the existing fields");
    assert.equal(JSON.stringify(rest), JSON.stringify(await mainStats.computeDashboardStats(uid)), `hero fields of ${uid} byte-identical to main`);
  }
  const bStats = await computeHeroStats(B);
  assert.equal(bStats.rdv, 2, "seeded bookings are counted (the comparison is not over empty stats)");
  console.log("hero: other fields byte-identical to origin/main for 8 accounts");

  // ── Timing (printed, not asserted: machine-dependent) ───────────────────
  const time = async (fn: () => Promise<unknown>, n = 30) => {
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await fn();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return `median ${ms[Math.floor(n / 2)].toFixed(1)} ms, p95 ${ms[Math.floor(n * 0.95)].toFixed(1)} ms`;
  };
  console.log(`perf computeAgentState(live, full dry resolver): ${await time(() => computeAgentState(B))}`);
  console.log(`perf computeAgentState(to_activate): ${await time(() => computeAgentState(A))}`);
  console.log(`perf main computeDashboardStats: ${await time(() => mainStats.computeDashboardStats(B))}`);
  console.log(`perf computeHeroStats (stats + agentState in parallel): ${await time(() => computeHeroStats(B))}`);
  assert.deepEqual(await fingerprint(), before, "still nothing written after the timing runs");

  // ── Contrast: the LIVE handler on the same numbers DOES write ──────────
  const call = (q: string) =>
    liveRoute.GET(new NextRequest(`http://localhost/api/agent/config?${q}`, { headers: { "x-internal-secret": "test-internal-secret" } }));
  assert.equal((await call(`phone=${encodeURIComponent(NUM[B])}`)).status, 200);
  assert.equal((await call(`phone=${encodeURIComponent(NUM[F])}`)).status, 200);
  assert.equal((await call(`phone=${encodeURIComponent(NUM[C])}`)).status, 403);
  assert.equal((await call(`phone=${encodeURIComponent(NUM[D])}`)).status, 404);
  await new Promise((r) => setTimeout(r, 300));
  const evs = rows<{ event: string }>(await exec(sql`SELECT event FROM events WHERE event <> 'book_success' ORDER BY event`)).map((r) => r.event);
  for (const e of ["agent_config_loaded", "trial_exhausted_block", "unknown_dialed_number", "agent_webhook_unsafe"]) {
    assert.ok(evs.includes(e), `the live handler writes ${e} (got ${evs.join(",")})`);
  }
  const [fwdLive] = rows<{ v: string | null }>(await exec(sql`SELECT forwarding_verified_at AS v FROM agent_configs WHERE user_id = ${B}`));
  assert.notEqual(fwdLive.v, null, "the live handler verifies forwarding (the dry run did not)");
  assert.deepEqual(network.dns, ["brain-f.example.com"], "the live handler looks up DNS (the dry run did not)");
  console.log("contrast: the live handler writes events, verifies forwarding and looks up DNS");

  console.log("ALL AGENT-STATE-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
