// agentState decision (lib/agent-state/decide.ts): ordered checks, first
// failure wins, later checks never run after a failure. The seeded-DB table
// (real resolver, dry run) is scripts/tests/agent-state-db.test.ts.
// Run with:  npx tsx scripts/tests/agent-state.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideAgentState, engineReachable, recordedHeartbeat, type AgentStateChecks } from "../../lib/agent-state/decide";
import { HEARTBEAT_STALE_MS } from "../../lib/monitoring-rules";

type Facts = { number: boolean; subscription: boolean; config: boolean; engine?: boolean };

async function run(facts: Facts) {
  const ran: string[] = [];
  const checks: AgentStateChecks = {
    hasNumber: () => (ran.push("number"), facts.number),
    subscriptionAllowsCalls: async () => (ran.push("subscription"), facts.subscription),
    configAvailable: async () => (ran.push("config"), facts.config),
    engineReachable: () => (ran.push("engine"), facts.engine ?? true),
  };
  return { state: await decideAgentState(checks), ran };
}

async function main() {
  // The full table: 2^4 fact combinations → exactly one state each.
  for (const number of [false, true])
    for (const subscription of [false, true])
      for (const config of [false, true])
        for (const engine of [false, true]) {
          const { state, ran } = await run({ number, subscription, config, engine });
          const label = JSON.stringify({ number, subscription, config, engine });
          if (!number) {
            assert.deepEqual(state, { state: "to_activate", reason: null }, label);
            assert.deepEqual(ran, ["number"], `${label}: nothing runs after no_number`);
          } else if (!subscription) {
            assert.deepEqual(state, { state: "attention", reason: "subscription_inactive" }, label);
            assert.deepEqual(ran, ["number", "subscription"], `${label}: the resolver does not run`);
          } else if (!config) {
            assert.deepEqual(state, { state: "attention", reason: "config_unavailable" }, label);
            assert.deepEqual(ran, ["number", "subscription", "config"], label);
          } else if (!engine) {
            assert.deepEqual(state, { state: "attention", reason: "engine_unreachable" }, label);
            assert.deepEqual(ran, ["number", "subscription", "config", "engine"], label);
          } else {
            assert.deepEqual(state, { state: "live", reason: null }, label);
            assert.deepEqual(ran, ["number", "subscription", "config", "engine"], label);
          }
        }

  // Check 4 from the stored heartbeat (what readHeartbeat returns).
  const now = Date.parse("2026-11-15T12:00:00Z");
  const hb = (ageMs: number) => ({ at: now - ageMs, agentName: "mock-agent", version: "0.0.0-test" });
  const MIN = 60_000;
  const viaHeartbeat = (stored: unknown, facts: Omit<Facts, "engine"> = { number: true, subscription: true, config: true }) =>
    run({ ...facts, engine: engineReachable(stored, now) }).then((r) => r.state);

  assert.deepEqual(await viaHeartbeat(hb(2 * MIN)), { state: "live", reason: null }, "fresh heartbeat → live");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN)), { state: "attention", reason: "engine_unreachable" }, "stale heartbeat (13 min) → engine_unreachable");
  assert.deepEqual(await viaHeartbeat(null), { state: "live", reason: null }, "never recorded → check skipped → live");
  // Same threshold as the admin alert, no second one: exactly 12 min is fresh, one ms more is stale.
  assert.equal(HEARTBEAT_STALE_MS, 12 * MIN);
  assert.equal(engineReachable(hb(HEARTBEAT_STALE_MS), now), true, "12 min exactly → still fresh");
  assert.equal(engineReachable(hb(HEARTBEAT_STALE_MS + 1), now), false, "just past 12 min → stale");
  // Stale, but an earlier check fails: the earlier reason wins.
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: true, subscription: false, config: true }), { state: "attention", reason: "subscription_inactive" }, "stale + subscription_inactive → subscription_inactive");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: true, subscription: true, config: false }), { state: "attention", reason: "config_unavailable" }, "stale + config_unavailable → config_unavailable");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: false, subscription: true, config: true }), { state: "to_activate", reason: null }, "stale + no number → to_activate");
  // An unparseable `at` counts as never recorded (skipped), not as stale.
  for (const stored of [{ agentName: "mock-agent" }, { at: "2026-11-15T11:00:00Z" }, { at: null }, { at: Number.NaN }, { at: Infinity }, "garbage", 42, []]) {
    assert.equal(recordedHeartbeat(stored), null, `${JSON.stringify(stored)} is not a recorded heartbeat`);
    assert.equal(engineReachable(stored, now), true, `${JSON.stringify(stored)} → skipped`);
  }
  // keys.openai === "invalid" is not engine_unreachable (out of scope).
  assert.equal(engineReachable({ ...hb(MIN), keys: { openai: "invalid" } }, now), true, "a dead OpenAI key is not engine_unreachable");

  // The value is plain JSON: exactly { state, reason }.
  const { state } = await run({ number: true, subscription: true, config: true });
  assert.deepEqual(Object.keys(state), ["state", "reason"]);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

  // Client bundle: the types module a client file imports has no imports at
  // all (so nothing server-side can ride along), and the client types file
  // imports it type-only.
  const typesSrc = readFileSync(new URL("../../lib/agent-state/types.ts", import.meta.url), "utf8");
  assert.doesNotMatch(typesSrc, /^\s*import\b/m, "lib/agent-state/types.ts imports nothing");
  const clientTypes = readFileSync(new URL("../../app/[locale]/dashboard/config/types.ts", import.meta.url), "utf8");
  assert.match(clientTypes, /^import type \{ AgentState \} from "@\/lib\/agent-state\/types";$/m);
  assert.doesNotMatch(clientTypes, /from "@\/lib\/agent-state\/(compute|decide)"/);

  console.log("ALL AGENT-STATE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
