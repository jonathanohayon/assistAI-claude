// /api/v1/demo-agent is off unless DEMO_AGENT_ENABLED=true.
// Run with:  npx tsx scripts/tests/demo-agent-flag.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

async function main() {
  delete process.env.DEMO_AGENT_ENABLED;
  const route = await import("../../app/api/v1/demo-agent/route");
  const { demoAgentEnabled } = await import("../../lib/demo-agent-flag");

  // the flag: only the exact string "true" turns it on
  assert.equal(demoAgentEnabled({}), false);
  assert.equal(demoAgentEnabled({ DEMO_AGENT_ENABLED: "1" }), false);
  assert.equal(demoAgentEnabled({ DEMO_AGENT_ENABLED: "true" }), true);

  // default: both handlers answer 404 before any OpenAI call
  const post = await route.POST(
    new NextRequest("https://example.test/api/v1/demo-agent", {
      method: "POST",
      body: JSON.stringify({ call_id: "c1", turn_id: "t1", language: "en", transcript: "hello", history: [] }),
    }),
  );
  assert.equal(post.status, 404);
  assert.equal((await route.GET()).status, 404);

  console.log("ALL DEMO-AGENT-FLAG TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
