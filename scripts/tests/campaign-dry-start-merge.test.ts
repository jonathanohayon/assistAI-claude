// Unit tests for mergeDryStartTick (lib/campaigns/live.ts): a dry campaign
// START folds its own byCampaign entry into the stored (cron) tick and leaves
// everything else alone. DB proof (row lock, concurrency): campaign-dispatch-tick-db.
// Run with:  npx tsx scripts/tests/campaign-dry-start-merge.test.ts
import assert from "node:assert/strict";

import { mergeDryStartTick, tickForViewer, type DispatchTick } from "../../lib/campaigns/live";

const A = "00000000-0000-4000-8000-00000000aaa1";
const B = "00000000-0000-4000-8000-00000000bbb1";
const CRON_AT = "2026-11-23T10:00:00.000Z";
const START_AT = "2026-11-23T10:00:30.000Z";

const cron: DispatchTick = {
  at: CRON_AT,
  source: "cron",
  mode: "dry",
  claimed: 0,
  dialed: 0,
  failed: 0,
  runningCampaigns: 2,
  wouldDial: {
    campaignsDue: 2,
    contactsDue: 5,
    skippedCallHours: 0,
    skippedConcurrency: 1,
    byCampaign: {
      [A]: { due: 2, heldByHours: 0, heldByConcurrency: 1 },
      [B]: { due: 3, heldByHours: 0, heldByConcurrency: 0 },
    },
  },
};
// What a start of A computes on its own (A only).
const startOf = (entry?: { due: number; heldByHours: number; heldByConcurrency: number }): DispatchTick => ({
  at: START_AT,
  source: "start",
  mode: "dry",
  claimed: 0,
  dialed: 0,
  failed: 0,
  runningCampaigns: 2,
  wouldDial: {
    campaignsDue: entry && entry.due > 0 ? 1 : 0,
    contactsDue: entry?.due ?? 0,
    skippedCallHours: entry?.heldByHours ?? 0,
    skippedConcurrency: entry?.heldByConcurrency ?? 0,
    byCampaign: entry ? { [A]: entry } : {},
  },
});

// A cron tick with A and B, then a dry start of A: B's entry and the globals
// are intact, A's entry updated and stamped with the start's instant.
const merged = mergeDryStartTick(JSON.stringify(cron), A, startOf({ due: 1, heldByHours: 0, heldByConcurrency: 0 }));
assert.deepEqual(merged, {
  ...cron,
  wouldDial: {
    ...cron.wouldDial!,
    byCampaign: {
      [A]: { due: 1, heldByHours: 0, heldByConcurrency: 0, at: START_AT },
      [B]: { due: 3, heldByHours: 0, heldByConcurrency: 0 },
    },
  },
});
assert.equal(merged.at, CRON_AT, "the tick's at stays the cron's");
assert.equal(merged.source, "cron", "the tick's source stays the cron's");
assert.equal(merged.wouldDial!.contactsDue, 5, "globals untouched (the cron's view)");

// A start of a campaign now at raw due 0: its entry removed, the others intact.
const gone = mergeDryStartTick(JSON.stringify(cron), A, startOf(undefined));
assert.deepEqual(gone.wouldDial!.byCampaign, { [B]: { due: 3, heldByHours: 0, heldByConcurrency: 0 } });
assert.deepEqual({ ...gone, wouldDial: undefined }, { ...cron, wouldDial: undefined });

// No stored tick: a fresh dry tick with just the start's entry.
for (const none of [null, undefined, ""]) {
  const fresh = mergeDryStartTick(none, A, startOf({ due: 2, heldByHours: 0, heldByConcurrency: 1 }));
  assert.equal(fresh.source, "start");
  assert.equal(fresh.at, START_AT);
  assert.deepEqual(fresh.wouldDial, {
    campaignsDue: 1,
    contactsDue: 2,
    skippedCallHours: 0,
    skippedConcurrency: 1,
    byCampaign: { [A]: { due: 2, heldByHours: 0, heldByConcurrency: 1, at: START_AT } },
  });
}

// After an "on" tick, a legacy tick without mode, or unparsable JSON: a fresh
// dry tick (an "on" tick carries no dry entry to merge into).
const on: DispatchTick = { at: CRON_AT, source: "cron", mode: "on", claimed: 2, dialed: 2, failed: 0, runningCampaigns: 2 };
const { mode: _m, ...legacy } = on;
for (const raw of [JSON.stringify(on), JSON.stringify(legacy), "{not json", "null", "42", JSON.stringify({ ...cron, wouldDial: null })]) {
  const t = mergeDryStartTick(raw, A, startOf({ due: 1, heldByHours: 0, heldByConcurrency: 0 }));
  assert.equal(t.mode, "dry", `fresh dry tick after ${raw.slice(0, 20)}`);
  assert.equal(t.source, "start");
  assert.deepEqual(Object.keys(t.wouldDial!.byCampaign!), [A]);
}
// A fresh start with nothing due: an empty byCampaign.
assert.deepEqual(mergeDryStartTick(null, A, startOf(undefined)).wouldDial!.byCampaign, {});

// The merged tick through tickForViewer: tenant A sees its own entry (with its
// own at), never B's; tenant B sees its cron entry, no start stamp.
const aView = tickForViewer(merged, A, false)!;
assert.deepEqual(aView.wouldDial, { byCampaign: { [A]: { due: 1, heldByHours: 0, heldByConcurrency: 0, at: START_AT } } });
assert.ok(!JSON.stringify(aView).includes(B) && !JSON.stringify(aView).includes("contactsDue"));
const bView = tickForViewer(merged, B, false)!;
assert.deepEqual(bView.wouldDial, { byCampaign: { [B]: { due: 3, heldByHours: 0, heldByConcurrency: 0 } } });
assert.ok(!JSON.stringify(bView).includes(A) && !JSON.stringify(bView).includes(START_AT));

// The stored input is never mutated.
assert.deepEqual(Object.keys(cron.wouldDial!.byCampaign!), [A, B]);

console.log("ALL CAMPAIGN-DRY-START-MERGE TESTS PASSED");
