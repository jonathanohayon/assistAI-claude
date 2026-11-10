// Unit tests for lib/agent/session-config/origin.ts (A3 single route params).
// Run with:  npx tsx scripts/tests/session-config-origin.test.ts
import assert from "node:assert/strict";

import { originFromParams } from "../../lib/agent/session-config/origin";

const p = (q: string) => originFromParams(new URLSearchParams(q));

assert.deepEqual(p("origin=phone&phone=%2B972&caller=%2B33"), { ok: true, origin: { kind: "phone", calledNumber: "+972" } });
assert.deepEqual(p("origin=web&userId=u1"), { ok: true, origin: { kind: "web", userId: "u1" } });
assert.deepEqual(p("origin=call_me&userId=u1"), { ok: true, origin: { kind: "call_me", userId: "u1" } });
assert.deepEqual(p("origin=campaign&campaignId=c&contactId=k"), { ok: true, origin: { kind: "campaign", campaignId: "c", contactId: "k" } });
assert.deepEqual(p("origin=outbound_test&agentId=a"), { ok: true, origin: { kind: "outbound_test", agentId: "a" } });

// the legacy handler gives userId priority over phone: a mix is refused, not guessed
assert.deepEqual(p("origin=phone&phone=%2B972&userId=u1"), { ok: false, error: "bad_origin_params" });
assert.deepEqual(p("origin=web&userId=u1&phone=%2B972"), { ok: false, error: "bad_origin_params" });
assert.deepEqual(p("origin=web&userId="), { ok: false, error: "bad_origin_params" });
assert.deepEqual(p("origin=campaign&campaignId=c"), { ok: false, error: "bad_origin_params" });
assert.deepEqual(p("origin=outbound_test"), { ok: false, error: "bad_origin_params" });
assert.deepEqual(p("origin=vox&phone=%2B972"), { ok: false, error: "external_origin" });
assert.deepEqual(p("phone=%2B972"), { ok: false, error: "unknown_origin" });
assert.deepEqual(p("origin=nope"), { ok: false, error: "unknown_origin" });

console.log("ALL SESSION-CONFIG ORIGIN TESTS PASSED");
