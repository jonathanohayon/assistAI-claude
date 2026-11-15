// agentState decision (lib/agent-state/decide.ts): ordered checks, first
// failure wins, later checks never run after a failure. The seeded-DB table
// (real resolver, dry run) is scripts/tests/agent-state-db.test.ts.
// Run with:  npx tsx scripts/tests/agent-state.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideAgentState, type AgentStateChecks } from "../../lib/agent-state/decide";

async function run(facts: { number: boolean; subscription: boolean; config: boolean }) {
  const ran: string[] = [];
  const checks: AgentStateChecks = {
    hasNumber: () => (ran.push("number"), facts.number),
    subscriptionAllowsCalls: async () => (ran.push("subscription"), facts.subscription),
    configAvailable: async () => (ran.push("config"), facts.config),
  };
  return { state: await decideAgentState(checks), ran };
}

async function main() {
  // The full table: 2^3 fact combinations → exactly one state each.
  for (const number of [false, true])
    for (const subscription of [false, true])
      for (const config of [false, true]) {
        const { state, ran } = await run({ number, subscription, config });
        const label = JSON.stringify({ number, subscription, config });
        if (!number) {
          assert.deepEqual(state, { state: "to_activate", reason: null }, label);
          assert.deepEqual(ran, ["number"], `${label}: nothing runs after no_number`);
        } else if (!subscription) {
          assert.deepEqual(state, { state: "attention", reason: "subscription_inactive" }, label);
          assert.deepEqual(ran, ["number", "subscription"], `${label}: the resolver does not run`);
        } else if (!config) {
          assert.deepEqual(state, { state: "attention", reason: "config_unavailable" }, label);
          assert.deepEqual(ran, ["number", "subscription", "config"], label);
        } else {
          assert.deepEqual(state, { state: "live", reason: null }, label);
          assert.deepEqual(ran, ["number", "subscription", "config"], label);
        }
      }

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
