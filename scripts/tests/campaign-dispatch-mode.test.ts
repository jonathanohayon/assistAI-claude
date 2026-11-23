// Unit tests for CAMPAIGN_DISPATCH (lib/campaigns/dispatch-mode.ts) and the
// dry-run totals (lib/campaigns/dispatch.ts). DB proof: scripts/campaign-dispatch-check.ts.
// Run with:  npx tsx scripts/tests/campaign-dispatch-mode.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dispatchMode } from "../../lib/campaigns/dispatch-mode";
import { dryRunTotals } from "../../lib/campaigns/dispatch";

// Off unless explicitly "dry" or "on".
for (const v of [undefined, "", "off", "yes", "true", "1", "ON-ish"]) assert.equal(dispatchMode({ CAMPAIGN_DISPATCH: v }), "off", String(v));
assert.equal(dispatchMode({ CAMPAIGN_DISPATCH: "dry" }), "dry");
assert.equal(dispatchMode({ CAMPAIGN_DISPATCH: " ON " }), "on");
assert.equal(dispatchMode({}), "off");

// Dry totals: the claim's own rule — at most the free slots per campaign —
// then the global limit. byCampaign mirrors it per campaign id.
let n = 0;
const c = (due: number, inHours: boolean, freeSlots = 5) => ({ id: `c${++n}`, due, inHours, freeSlots });
const globals = (r: ReturnType<typeof dryRunTotals>) => {
  const { byCampaign: _by, ...rest } = r;
  return rest;
};

// Mixed: in hours, out of hours, concurrency full, nothing due.
n = 0;
const mixed = dryRunTotals([c(3, true), c(1, false), c(2, true, 0), c(0, true)], 10);
assert.deepEqual(globals(mixed), { campaignsDue: 1, contactsDue: 3, skippedCallHours: 1, skippedConcurrency: 2 });
assert.deepEqual(mixed.byCampaign, {
  c1: { due: 3, heldByHours: 0, heldByConcurrency: 0 },
  c2: { due: 0, heldByHours: 1, heldByConcurrency: 0 },
  c3: { due: 0, heldByHours: 0, heldByConcurrency: 2 },
}, "an entry per campaign with a raw due > 0; c4 (0 due) absent");

// Concurrency: 3 due, 2 free slots.
n = 0;
const conc = dryRunTotals([c(3, true, 2)], 10);
assert.deepEqual(globals(conc), { campaignsDue: 1, contactsDue: 2, skippedCallHours: 0, skippedConcurrency: 1 }, "concurrency 2 → 2");
assert.deepEqual(conc.byCampaign, { c1: { due: 2, heldByHours: 0, heldByConcurrency: 1 } });

// The global limit, shared across campaigns in order.
n = 0;
const lim5 = dryRunTotals([c(3, true), c(4, true)], 5);
assert.deepEqual(globals(lim5), { campaignsDue: 2, contactsDue: 5, skippedCallHours: 0, skippedConcurrency: 0 });
assert.deepEqual(lim5.byCampaign, { c1: { due: 3, heldByHours: 0, heldByConcurrency: 0 }, c2: { due: 2, heldByHours: 0, heldByConcurrency: 0 } });
n = 0;
const lim3 = dryRunTotals([c(3, true), c(4, true)], 3);
assert.deepEqual(globals(lim3), { campaignsDue: 1, contactsDue: 3, skippedCallHours: 0, skippedConcurrency: 0 });
assert.deepEqual(lim3.byCampaign, { c1: { due: 3, heldByHours: 0, heldByConcurrency: 0 }, c2: { due: 0, heldByHours: 0, heldByConcurrency: 0 } }, "limit spent: present, due 0");

// Out of hours only: present with due 0.
n = 0;
assert.deepEqual(dryRunTotals([c(3, false)], 10).byCampaign, { c1: { due: 0, heldByHours: 3, heldByConcurrency: 0 } });

// Per-campaign sums agree with the globals.
for (const r of [mixed, conc, lim5, lim3]) {
  const e = Object.values(r.byCampaign!);
  assert.equal(e.reduce((a, x) => a + x.due, 0), r.contactsDue);
  assert.equal(e.reduce((a, x) => a + x.heldByHours, 0), r.skippedCallHours);
  assert.equal(e.reduce((a, x) => a + x.heldByConcurrency, 0), r.skippedConcurrency);
  assert.equal(e.filter((x) => x.due > 0).length, r.campaignsDue);
}
assert.deepEqual(dryRunTotals([], 10), { campaignsDue: 0, contactsDue: 0, skippedCallHours: 0, skippedConcurrency: 0, byCampaign: {} });

// Tenant-facing responses carry a word, never the env name or a raw exception.
const status = readFileSync(new URL("../../app/api/dashboard/campaigns/[id]/status/route.ts", import.meta.url), "utf8");
assert.match(status, /dispatch = \{ error: "dispatch_failed" \}/);
assert.doesNotMatch(status, /error: e instanceof Error \? e\.message/);

console.log("ALL CAMPAIGN-DISPATCH-MODE TESTS PASSED");
