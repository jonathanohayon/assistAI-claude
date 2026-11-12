// lib/demo-session.ts: what the public landing demo gets back from
// POST /api/session, and the demo voice choice. Mock values only.
// Run with:  npx tsx scripts/tests/demo-session.test.ts
import assert from "node:assert/strict";

import {
  DEMO_SESSION_GLOBAL,
  DEMO_SESSION_PER_IP,
  DEMO_TOOL_ROUTES,
  demoSessionResponse,
  demoSessionVoice,
} from "../../lib/demo-session";
import { REALTIME_TOOLS } from "../../lib/realtime";

// The browser gets the token, the SDP URL, the transport and the tool routes:
// never the session the provider echoes (instructions, tools, model).
{
  const minted = {
    value: "ek_mock_1",
    expires_at: 1900000000,
    session: { model: "mock-model", instructions: "Mock prompt.", tools: [{ name: "mock_tool" }] },
  };
  const out = demoSessionResponse(minted, {
    webrtcUrl: "https://provider.example.test/v1/realtime/calls",
    model: "mock-model 2",
    transport: "webrtc",
  });
  assert.ok(out);
  assert.deepEqual(Object.keys(out).sort(), ["expires_at", "tools", "transport", "value", "webrtc_url"]);
  assert.equal(out.value, "ek_mock_1");
  assert.equal(out.expires_at, 1900000000);
  assert.equal(out.webrtc_url, "https://provider.example.test/v1/realtime/calls?model=mock-model%202");
  assert.equal(out.transport, "webrtc");
  assert.doesNotMatch(JSON.stringify(out), /Mock prompt|mock_tool|"session"|"instructions"/);
}
// No token from the provider → nothing to hand out.
const noToken: { value?: unknown; session: object } = { session: {} };
assert.equal(demoSessionResponse(noToken, { webrtcUrl: "u", model: "m", transport: "webrtc" }), null);
assert.equal(demoSessionResponse({ value: "" }, { webrtcUrl: "u", model: "m", transport: "webrtc" }), null);
// A missing expiry reads as null, not as whatever the provider sent.
assert.equal(demoSessionResponse({ value: "ek", expires_at: "soon" }, { webrtcUrl: "u", model: "m", transport: "webrtc" })?.expires_at, null);

// One route per tool the demo session declares, and nothing else.
assert.deepEqual(Object.keys(DEMO_TOOL_ROUTES).sort(), REALTIME_TOOLS.map((t) => t.name).sort());
assert.deepEqual(DEMO_TOOL_ROUTES.end_call, { hangUp: true });
for (const [name, route] of Object.entries(DEMO_TOOL_ROUTES)) {
  if ("endpoint" in route) assert.match(route.endpoint, /^\/api\/(calendar|sheets)\//, name);
}

// Voice: as the browser used to choose it.
const allowed = ["alloy", "coral", "marin"];
assert.equal(demoSessionVoice({ demoVoice: "coral", allowed, catalogueDefault: "marin", routeDefault: "alloy" }), "coral");
assert.equal(demoSessionVoice({ demoVoice: null, allowed, catalogueDefault: "marin", routeDefault: "alloy" }), "marin");
assert.equal(demoSessionVoice({ demoVoice: "", allowed, catalogueDefault: "marin", routeDefault: "alloy" }), "marin");
assert.equal(demoSessionVoice({ demoVoice: "eve", allowed, catalogueDefault: "marin", routeDefault: "alloy" }), "alloy");
assert.equal(demoSessionVoice({ demoVoice: null, allowed: ["eve"], catalogueDefault: "marin", routeDefault: "eve" }), "eve");

// The limiter's global ceiling is the backstop of the per-IP cap.
assert.ok(Number.isInteger(DEMO_SESSION_PER_IP) && DEMO_SESSION_GLOBAL > DEMO_SESSION_PER_IP);

console.log("ALL DEMO-SESSION TESTS PASSED");
