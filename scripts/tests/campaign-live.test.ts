// Live campaign console helpers (lib/campaigns/live.ts).
// Run with:  npx tsx scripts/tests/campaign-live.test.ts

import assert from "node:assert/strict";

import {
  campaignBlockers,
  contactRank,
  isCallState,
  isInCallWindow,
  shouldApplyCallState,
} from "../../lib/campaigns/live";

const weekdays = { timezone: "Asia/Jerusalem", days: [0, 1, 2, 3, 4], startHour: 9, endHour: 18 };

// 2026-11-05 is a Thursday (4). Jerusalem is UTC+2 in November.
assert.equal(isInCallWindow(weekdays, new Date("2026-11-05T08:00:00Z")), true); // 10:00 local
assert.equal(isInCallWindow(weekdays, new Date("2026-11-05T06:59:00Z")), false); // 08:59 local
assert.equal(isInCallWindow(weekdays, new Date("2026-11-05T16:00:00Z")), false); // 18:00 local, end excluded
assert.equal(isInCallWindow(weekdays, new Date("2026-11-06T08:00:00Z")), false); // Friday
assert.equal(isInCallWindow({ ...weekdays, timezone: "Not/AZone" }, new Date()), false);

const inWindow = new Date("2026-11-05T08:00:00Z");
const base = { status: "running", callWindow: weekdays, concurrency: 3, inFlight: 0, dueQueued: 5 };
assert.deepEqual(campaignBlockers(base, inWindow), []);
assert.deepEqual(campaignBlockers({ ...base, status: "paused" }, inWindow), ["campaign_not_running"]);
assert.deepEqual(campaignBlockers({ ...base, inFlight: 3 }, inWindow), ["concurrency_full"]);
assert.deepEqual(campaignBlockers({ ...base, dueQueued: 0 }, inWindow), ["no_due_contacts"]);
assert.deepEqual(
  campaignBlockers(base, new Date("2026-11-06T08:00:00Z")),
  ["outside_call_window"],
);

// call state only moves forward, except a new dial
assert.equal(shouldApplyCallState("", "ringing"), true);
assert.equal(shouldApplyCallState("dialing", "ringing"), true);
assert.equal(shouldApplyCallState("in_call", "ringing"), false);
assert.equal(shouldApplyCallState("ended", "in_call"), false);
assert.equal(shouldApplyCallState("ended", "dialing"), true);
assert.equal(isCallState("ringing"), true);
assert.equal(isCallState("hacked"), false);

// live calls sort before the queue, the queue before finished contacts
assert.ok(contactRank("calling", "in_call") < contactRank("calling", "ringing"));
assert.ok(contactRank("calling", "ringing") < contactRank("queued", ""));
assert.ok(contactRank("queued", "") < contactRank("completed", "ended"));

console.log("ALL CAMPAIGN-LIVE TESTS PASSED");
