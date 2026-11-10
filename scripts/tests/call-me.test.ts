// "Call me" (V7b): lib/call-me.ts + the room name the worker parses.
// Mock numbers only. Run with:  npx tsx scripts/tests/call-me.test.ts

import assert from "node:assert/strict";

import { CALL_ME_COOLDOWN_MS, callMeAccess, callMeAllowed, callMeAllowedTargets, callMeMode, callMeTarget } from "../../lib/call-me";
import { CALL_ME_ROOM_PREFIX, callMeRoomName } from "../../lib/campaigns/dial";

// target: ONLY the account's own numbers (owner WhatsApp, transfer number)
const acct = { ownerWhatsapp: "+972500000001", transferNumber: "+97230000000" };
assert.equal(callMeTarget(undefined, acct), "+972500000001", "default = owner WhatsApp");
assert.equal(callMeTarget("  ", acct), "+972500000001");
assert.equal(callMeTarget("+97230000000", acct), "+97230000000", "transfer number allowed");
assert.equal(callMeTarget("+972 50-000 0001", acct), "+972500000001", "spaces/dashes stripped");
assert.equal(callMeTarget("+972500000009", acct), null, "free-form number refused");
assert.equal(callMeTarget("0500000001", acct), null, "local format refused");
assert.equal(callMeTarget(undefined, { ownerWhatsapp: "", transferNumber: "" }), null, "no number on the account");
assert.equal(callMeTarget(undefined, { ownerWhatsapp: "", transferNumber: "+97230000000" }), null, "default is the owner's WhatsApp only");
assert.equal(callMeTarget(42, acct), null);
assert.deepEqual(callMeAllowedTargets({ ownerWhatsapp: "+972500000001", transferNumber: "+972500000001" }), ["+972500000001"]);
// server-side switch: OFF for everyone by default (admins included)
assert.equal(callMeMode({}), "off");
assert.equal(callMeMode({ CALL_ME: "" }), "off");
assert.equal(callMeMode({ CALL_ME: "yes" }), "off", "unknown value = off");
assert.equal(callMeMode({ CALL_ME: " Admin " }), "admin");
assert.equal(callMeMode({ CALL_ME: "all" }), "all");
assert.equal(callMeAccess("off", true), "call_me_disabled", "off: admins refused too");
assert.equal(callMeAccess("off", false), "call_me_disabled");
assert.equal(callMeAccess("admin", true), null);
assert.equal(callMeAccess("admin", false), "admin_only");
assert.equal(callMeAccess("all", false), null);
assert.equal(callMeAccess("all", true), null);

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
