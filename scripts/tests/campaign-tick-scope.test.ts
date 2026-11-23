// Unit tests for tickForViewer (lib/campaigns/live.ts): the dispatcher's last
// tick is ONE global row covering every tenant's running campaigns, so a
// non-admin viewer of one campaign gets only that campaign's dry entry and no
// global count. DB proof through the real route: campaign-dispatch-tick-db.
// Run with:  npx tsx scripts/tests/campaign-tick-scope.test.ts
import assert from "node:assert/strict";

import { tickForViewer, type DispatchTick } from "../../lib/campaigns/live";

const A = "00000000-0000-4000-8000-00000000aaa1"; // tenant A's campaign
const B = "00000000-0000-4000-8000-00000000bbb1"; // tenant B's campaign
const B2 = "00000000-0000-4000-8000-00000000bbb2"; // tenant B, out of hours

const dry: DispatchTick = {
  at: "2026-11-23T10:00:00.000Z",
  source: "cron",
  mode: "dry",
  claimed: 0,
  dialed: 0,
  failed: 0,
  runningCampaigns: 3,
  wouldDial: {
    campaignsDue: 2,
    contactsDue: 9,
    skippedCallHours: 71,
    skippedConcurrency: 4,
    byCampaign: {
      [A]: { due: 2, heldByHours: 0, heldByConcurrency: 1 },
      [B]: { due: 7, heldByHours: 0, heldByConcurrency: 3 },
      [B2]: { due: 0, heldByHours: 71, heldByConcurrency: 0 },
    },
  },
};

// Tenant A: only A's entry, the non-count keys kept, no global count.
const a = tickForViewer(dry, A, false);
assert.deepEqual(a, {
  at: dry.at,
  source: "cron",
  mode: "dry",
  claimed: 0,
  dialed: 0,
  failed: 0,
  wouldDial: { byCampaign: { [A]: { due: 2, heldByHours: 0, heldByConcurrency: 1 } } },
});
const body = JSON.stringify(a);
for (const leak of [B, B2, "bbb", "runningCampaigns", "campaignsDue", "contactsDue", "skippedCallHours", "skippedConcurrency", ":7", ":71", ":9", ":3"])
  assert.ok(!body.includes(leak), `tenant A's tick never carries ${leak}`);

// A campaign absent from byCampaign (nothing due): an explicit 0/0/0 entry.
const C = "00000000-0000-4000-8000-00000000ccc1";
assert.deepEqual(tickForViewer(dry, C, false)?.wouldDial, { byCampaign: { [C]: { due: 0, heldByHours: 0, heldByConcurrency: 0 } } });

// A dry tick written before byCampaign existed: 0/0/0, still no global count.
const { byCampaign: _by, ...oldCounts } = dry.wouldDial!;
const old = tickForViewer({ ...dry, wouldDial: oldCounts }, A, false);
assert.deepEqual(old?.wouldDial, { byCampaign: { [A]: { due: 0, heldByHours: 0, heldByConcurrency: 0 } } });
assert.ok(!JSON.stringify(old).includes("contactsDue"));

// An on tick (no wouldDial): no wouldDial key, no runningCampaigns.
const on: DispatchTick = { at: dry.at, source: "start", mode: "on", claimed: 2, dialed: 2, failed: 0, runningCampaigns: 5 };
assert.deepEqual(tickForViewer(on, A, false), { at: dry.at, source: "start", mode: "on", claimed: 2, dialed: 2, failed: 0 });

// A legacy tick without mode: no mode key invented.
const { mode: _m, ...legacy } = on;
assert.deepEqual(Object.keys(tickForViewer(legacy, A, false)!), ["at", "source", "claimed", "dialed", "failed"]);

// An unknown key added to the stored tick later never reaches a tenant.
const future = { ...dry, tenantsList: [B] } as DispatchTick;
assert.ok(!JSON.stringify(tickForViewer(future, A, false)).includes(B));

// Admin: the full stored tick, unchanged (same object).
assert.equal(tickForViewer(dry, A, true), dry);
assert.equal(tickForViewer(on, A, true), on);

// No tick yet: null for everyone.
assert.equal(tickForViewer(null, A, false), null);
assert.equal(tickForViewer(null, A, true), null);

console.log("ALL CAMPAIGN-TICK-SCOPE TESTS PASSED");
