// "Call me" (V7b): lib/call-me.ts + the room name the worker parses.
// Mock numbers only. Run with:  npx tsx scripts/tests/call-me.test.ts

import assert from "node:assert/strict";

import { CALL_ME_COOLDOWN_MS, callMeAllowed, callMeTarget } from "../../lib/call-me";
import { CALL_ME_ROOM_PREFIX, callMeRoomName } from "../../lib/campaigns/dial";

// target: body number, else the owner's WhatsApp; E.164 only
assert.equal(callMeTarget("+972500000000", "+972500000001"), "+972500000000");
assert.equal(callMeTarget(undefined, "+972500000001"), "+972500000001");
assert.equal(callMeTarget("  ", "+972500000001"), "+972500000001");
assert.equal(callMeTarget("+972 50-000 0000", null), "+972500000000", "spaces/dashes stripped");
assert.equal(callMeTarget("0500000000", null), null, "local format refused (E.164 required)");
assert.equal(callMeTarget(undefined, ""), null);
assert.equal(callMeTarget(42, null), null);

// cooldown: one call-back every 2 minutes
const now = new Date("2026-11-10T20:00:00Z");
assert.equal(callMeAllowed(null, now), true);
assert.equal(callMeAllowed(new Date(now.getTime() - CALL_ME_COOLDOWN_MS + 1000), now), false);
assert.equal(callMeAllowed(new Date(now.getTime() - CALL_ME_COOLDOWN_MS), now), true);

// room name = what the worker's origin parser expects: callme__<userId>__<ts>
const uid = "00000000-0000-0000-0000-00000000000a";
const room = callMeRoomName(uid, 1_700_000_000_000);
assert.equal(room, `${CALL_ME_ROOM_PREFIX}${uid}__${(1_700_000_000_000).toString(36)}`);
assert.equal(room.split("__")[1], uid);
assert.ok(!room.includes("972500000000") && !room.includes("+"), "the dialled number never appears in the room name");

console.log("ALL CALL-ME TESTS PASSED");
