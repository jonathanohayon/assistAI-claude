// Live campaign console view helpers (lib/campaigns/live-view.ts).
// Run with:  npx tsx scripts/tests/campaign-live-view.test.ts

import assert from "node:assert/strict";

import {
  contactView,
  counterBuckets,
  eventLine,
  formatElapsed,
  mergeEvents,
  nextSince,
  tickSkips,
  type LiveContact,
  type LiveEvent,
} from "../../lib/campaigns/live-view";

// Counters: missing keys are 0; failed groups every non-connected terminal.
assert.deepEqual(counterBuckets({}), { queued: 0, calling: 0, done: 0, failed: 0 });
assert.deepEqual(
  counterBuckets({ queued: 5, claimed: 1, calling: 2, completed: 3, no_answer: 1, busy: 1, voicemail: 1, failed: 1, skipped: 1 }),
  { queued: 5, calling: 3, done: 3, failed: 5 },
);

// Events: incremental pages merge without duplicates, newest first, capped.
const ev = (id: string, at: string, event = "x", data: Record<string, unknown> = {}): LiveEvent => ({
  id, at, event, level: "info", message: `m${id}`, contactId: null, data,
});
const page1 = [ev("b", "2026-11-05T10:00:02Z"), ev("a", "2026-11-05T10:00:01Z")];
const page2 = [ev("c", "2026-11-05T10:00:03Z"), ev("b", "2026-11-05T10:00:02Z")];
const merged = mergeEvents(page1, page2);
assert.deepEqual(merged.map((e) => e.id), ["c", "b", "a"]);
assert.equal(nextSince(merged), "2026-11-05T10:00:03Z");
assert.equal(nextSince([]), null);
assert.equal(mergeEvents(merged, [], 2).length, 2);

// Contact rows follow the feed's display rules.
const now = new Date("2026-11-05T10:00:00Z");
const c = (p: Partial<LiveContact>): LiveContact => ({
  contactId: "k", phoneNumber: "+15550000000", name: "", status: "queued", callState: "",
  callStateAt: null, attempts: 0, nextAttemptAt: null, ...p,
});
assert.deepEqual(contactView(c({ status: "calling", callState: "in_call", callStateAt: "2026-11-05T09:58:55Z" }), now), {
  kind: "live", state: "in_call", seconds: 65,
});
assert.deepEqual(contactView(c({ status: "calling", callState: "" }), now), { kind: "live", state: "dialing", seconds: 0 });
assert.deepEqual(contactView(c({ status: "claimed" }), now), { kind: "live", state: "claimed", seconds: 0 });
assert.deepEqual(contactView(c({ nextAttemptAt: "2026-11-05T11:00:00Z" }), now), { kind: "retry", at: "2026-11-05T11:00:00Z" });
assert.deepEqual(contactView(c({ nextAttemptAt: "2026-11-05T09:00:00Z" }), now), { kind: "queued" });
assert.deepEqual(contactView(c({ status: "no_answer" }), now), { kind: "outcome", outcome: "no_answer" });

assert.equal(formatElapsed(0), "0:00");
assert.equal(formatElapsed(65), "1:05");
assert.equal(formatElapsed(3725), "1:02:05");

// dispatch_tick skip reasons (string[] today; tolerate {reason} objects).
assert.deepEqual(tickSkips({ skipped: ["outside_call_window", "concurrency_full"] }), [
  ["outside_call_window", 1], ["concurrency_full", 1],
]);
assert.deepEqual(tickSkips({ skipped: [{ reason: "x" }, { reason: "x" }] }), [["x", 2]]);
assert.deepEqual(tickSkips(null), []);

// Event lines.
assert.equal(eventLine(ev("1", now.toISOString(), "dispatch_tick", { claimed: 3, dialed: 3, failed: 0 })).key, "tickDialed");
assert.equal(eventLine(ev("1", now.toISOString(), "dispatch_tick", { dialed: 0 })).key, "tickIdle");
assert.equal(eventLine(ev("1", now.toISOString(), "campaign_call_progress", { state: "ringing" })).key, "progress_ringing");
assert.deepEqual(eventLine(ev("1", now.toISOString(), "campaign_call_done", { outcome: "busy", durationSeconds: 0, retry: { inMinutes: 30 } })), {
  key: "doneRetry", params: { outcome: "busy", duration: "0:00", timed: "no", minutes: 30 }, contactId: null, tone: "warn",
});
assert.equal(eventLine(ev("1", now.toISOString(), "campaign_pause")).key, "status_pause");
assert.deepEqual(eventLine(ev("9", now.toISOString(), "something_new")).params, { message: "m9" });

console.log("ALL CAMPAIGN-LIVE-VIEW TESTS PASSED");
