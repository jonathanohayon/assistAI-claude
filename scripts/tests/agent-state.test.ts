// agentState decision (lib/agent-state/decide.ts): ordered checks, first
// failure wins, later checks never run after a failure. The seeded-DB table
// (real resolver, dry run) is scripts/tests/agent-state-db.test.ts.
// Run with:  npx tsx scripts/tests/agent-state.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideAgentState, engineReachable, recordedHeartbeat, trialReason, type AgentStateChecks } from "../../lib/agent-state/decide";
import type { AgentStateTrialReason } from "../../lib/agent-state/types";
import { TRIAL_PAUSED_STATUS, TRIAL_SECONDS_LIMIT, isTrialExhausted, trialExhaustionCause } from "../../lib/trial";
import { HEARTBEAT_STALE_MS } from "../../lib/monitoring-rules";

type Facts = { number: boolean; trial: AgentStateTrialReason | null; config: boolean; engine?: boolean };

async function run(facts: Facts) {
  const ran: string[] = [];
  const checks: AgentStateChecks = {
    hasNumber: () => (ran.push("number"), facts.number),
    trialRefusal: async () => (ran.push("trial"), facts.trial),
    configAvailable: async () => (ran.push("config"), facts.config),
    engineReachable: () => (ran.push("engine"), facts.engine ?? true),
  };
  return { state: await decideAgentState(checks), ran };
}

async function main() {
  // The full table: every fact combination → exactly one state each.
  for (const number of [false, true])
    for (const trial of [null, "trial_ended", "trial_minutes_exhausted"] as const)
      for (const config of [false, true])
        for (const engine of [false, true]) {
          const { state, ran } = await run({ number, trial, config, engine });
          const label = JSON.stringify({ number, trial, config, engine });
          if (!number) {
            assert.deepEqual(state, { state: "to_activate", reason: null }, label);
            assert.deepEqual(ran, ["number"], `${label}: nothing runs after no_number`);
          } else if (trial) {
            assert.deepEqual(state, { state: "attention", reason: trial }, label);
            assert.deepEqual(ran, ["number", "trial"], `${label}: the resolver does not run`);
          } else if (!config) {
            assert.deepEqual(state, { state: "attention", reason: "config_unavailable" }, label);
            assert.deepEqual(ran, ["number", "trial", "config"], label);
          } else if (!engine) {
            assert.deepEqual(state, { state: "attention", reason: "engine_unreachable" }, label);
            assert.deepEqual(ran, ["number", "trial", "config", "engine"], label);
          } else {
            assert.deepEqual(state, { state: "live", reason: null }, label);
            assert.deepEqual(ran, ["number", "trial", "config", "engine"], label);
          }
        }

  // Check 4 from the stored heartbeat (what readHeartbeat returns).
  const now = Date.parse("2026-11-15T12:00:00Z");
  const hb = (ageMs: number) => ({ at: now - ageMs, agentName: "mock-agent", version: "0.0.0-test" });
  const MIN = 60_000;
  const viaHeartbeat = (stored: unknown, facts: Omit<Facts, "engine"> = { number: true, trial: null, config: true }) =>
    run({ ...facts, engine: engineReachable(stored, now) }).then((r) => r.state);

  assert.deepEqual(await viaHeartbeat(hb(2 * MIN)), { state: "live", reason: null }, "fresh heartbeat → live");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN)), { state: "attention", reason: "engine_unreachable" }, "stale heartbeat (13 min) → engine_unreachable");
  assert.deepEqual(await viaHeartbeat(null), { state: "live", reason: null }, "never recorded → check skipped → live");
  // Same threshold as the admin alert, no second one: exactly 12 min is fresh, one ms more is stale.
  assert.equal(HEARTBEAT_STALE_MS, 12 * MIN);
  assert.equal(engineReachable(hb(HEARTBEAT_STALE_MS), now), true, "12 min exactly → still fresh");
  assert.equal(engineReachable(hb(HEARTBEAT_STALE_MS + 1), now), false, "just past 12 min → stale");
  // Stale, but an earlier check fails: the earlier reason wins.
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: true, trial: "trial_ended", config: true }), { state: "attention", reason: "trial_ended" }, "stale + trial_ended → trial_ended");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: true, trial: null, config: false }), { state: "attention", reason: "config_unavailable" }, "stale + config_unavailable → config_unavailable");
  assert.deepEqual(await viaHeartbeat(hb(13 * MIN), { number: false, trial: null, config: true }), { state: "to_activate", reason: null }, "stale + no number → to_activate");
  // An unparseable `at` counts as never recorded (skipped), not as stale.
  for (const stored of [{ agentName: "mock-agent" }, { at: "2026-11-15T11:00:00Z" }, { at: null }, { at: Number.NaN }, { at: Infinity }, "garbage", 42, []]) {
    assert.equal(recordedHeartbeat(stored), null, `${JSON.stringify(stored)} is not a recorded heartbeat`);
    assert.equal(engineReachable(stored, now), true, `${JSON.stringify(stored)} → skipped`);
  }
  // keys.openai === "invalid" is not engine_unreachable (out of scope).
  assert.equal(engineReachable({ ...hb(MIN), keys: { openai: "invalid" } }, now), true, "a dead OpenAI key is not engine_unreachable");

  // Trial reasons: the gate's cause (lib/trial.ts) → the agentState reason.
  const NOW = new Date("2026-11-15T12:00:00Z");
  const PAST = new Date("2026-11-14T12:00:00Z");
  const FUTURE = new Date("2026-11-20T12:00:00Z");
  type TrialArgs = Parameters<typeof trialExhaustionCause>[0];
  const trial = (over: Partial<TrialArgs>): TrialArgs => ({
    subscriptionStatus: "trialing", trialEndsAt: FUTURE, trialSecondsUsed: 0, role: "user", now: NOW, ...over,
  });
  const viaTrial = (args: TrialArgs) =>
    run({ number: true, trial: trialReason(trialExhaustionCause(args)), config: true }).then((r) => r.state);
  const cases: Array<[string, TrialArgs, unknown]> = [
    ["(a) trial end date passed → trial_ended", trial({ trialEndsAt: PAST }), { state: "attention", reason: "trial_ended" }],
    ["(b) trial minutes used up → trial_minutes_exhausted", trial({ trialSecondsUsed: TRIAL_SECONDS_LIMIT }), { state: "attention", reason: "trial_minutes_exhausted" }],
    ["(c) trial paused → trial_ended", trial({ subscriptionStatus: TRIAL_PAUSED_STATUS, trialEndsAt: PAST }), { state: "attention", reason: "trial_ended" }],
    ["(c) trial paused within limits → trial_ended", trial({ subscriptionStatus: TRIAL_PAUSED_STATUS }), { state: "attention", reason: "trial_ended" }],
    ["(a)+(b) both up → trial_ended", trial({ trialEndsAt: PAST, trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT }), { state: "attention", reason: "trial_ended" }],
    ["admin trialing, no end date, over the minutes → live", trial({ role: "admin", trialEndsAt: null, trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT }), { state: "live", reason: null }],
    ["admin paused → live", trial({ role: "admin", subscriptionStatus: TRIAL_PAUSED_STATUS, trialEndsAt: PAST }), { state: "live", reason: null }],
    ["paid active over the trial minutes → live", trial({ subscriptionStatus: "active", trialEndsAt: null, trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT }), { state: "live", reason: null }],
    ["paid active with a past trial end date and over the minutes → live", trial({ subscriptionStatus: "active", trialEndsAt: PAST, trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT }), { state: "live", reason: null }],
    ["trial within limits → live", trial({ trialSecondsUsed: TRIAL_SECONDS_LIMIT - 1 }), { state: "live", reason: null }],
  ];
  for (const [label, args, expected] of cases) assert.deepEqual(await viaTrial(args), expected, label);
  assert.equal(trialReason(null), null);
  assert.equal(trialReason(undefined), null);
  assert.equal(trialReason("time"), "trial_ended");
  assert.equal(trialReason("paused"), "trial_ended");
  assert.equal(trialReason("minutes"), "trial_minutes_exhausted");
  // isTrialExhausted is exactly "a cause exists": same boolean as before for every input.
  const legacyExhausted = (a: TrialArgs) => {
    if (a.role === "admin") return false;
    if (a.subscriptionStatus === TRIAL_PAUSED_STATUS) return true;
    if (a.subscriptionStatus !== "trialing") return false;
    const n = a.now ?? new Date();
    return (a.trialEndsAt ? n.getTime() >= a.trialEndsAt.getTime() : false) || a.trialSecondsUsed >= TRIAL_SECONDS_LIMIT;
  };
  for (const role of [undefined, null, "user", "admin"])
    for (const subscriptionStatus of ["trialing", TRIAL_PAUSED_STATUS, "active", "canceled", "past_due", ""])
      for (const trialEndsAt of [null, PAST, NOW, FUTURE])
        for (const trialSecondsUsed of [0, TRIAL_SECONDS_LIMIT - 1, TRIAL_SECONDS_LIMIT, 10 * TRIAL_SECONDS_LIMIT]) {
          const args: TrialArgs = { subscriptionStatus, trialEndsAt, trialSecondsUsed, role, now: NOW };
          assert.equal(isTrialExhausted(args), legacyExhausted(args), JSON.stringify(args));
          assert.equal(isTrialExhausted(args), trialExhaustionCause(args) !== null, JSON.stringify(args));
        }

  // The value is plain JSON: exactly { state, reason }.
  const { state } = await run({ number: true, trial: null, config: true });
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
