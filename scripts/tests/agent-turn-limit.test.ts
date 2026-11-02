// Per-tenant turn limit for /api/v1/agent/[token] (lib/agent-turn-limit.ts).
// Run with:  npx tsx scripts/tests/agent-turn-limit.test.ts

import assert from "node:assert/strict";

import { AGENT_TURNS_PER_MINUTE, createAgentTurnLimiter } from "../../lib/agent-turn-limit";

// a realistic call (~20 turns/min) is never limited
{
  const rl = createAgentTurnLimiter();
  for (let i = 0; i < 20; i++) assert.equal(rl.hit("tenant-a", i * 3000), true);
}

// a burst is cut after the per-minute budget, per tenant
{
  const rl = createAgentTurnLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < AGENT_TURNS_PER_MINUTE; i++) assert.equal(rl.hit("tenant-a", t0), true);
  assert.equal(rl.hit("tenant-a", t0), false);
  // another tenant is unaffected
  assert.equal(rl.hit("tenant-b", t0), true);
  // the next minute is allowed again
  assert.equal(rl.hit("tenant-a", t0 + 60_000), true);
}

console.log("ALL AGENT-TURN-LIMIT TESTS PASSED");
