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

// Dry totals: the claim's own rule, then the global limit.
const c = (due: number, inHours: boolean, underConcurrency = true) => ({ due, inHours, underConcurrency });
assert.deepEqual(dryRunTotals([c(3, true), c(1, false), c(2, true, false), c(0, true)], 10), {
  campaignsDue: 1, contactsDue: 3, skippedCallHours: 1, skippedConcurrency: 2,
});
assert.deepEqual(dryRunTotals([c(3, true), c(4, true)], 5), { campaignsDue: 2, contactsDue: 5, skippedCallHours: 0, skippedConcurrency: 0 });
assert.deepEqual(dryRunTotals([c(3, true), c(4, true)], 3), { campaignsDue: 1, contactsDue: 3, skippedCallHours: 0, skippedConcurrency: 0 });
assert.deepEqual(dryRunTotals([], 10), { campaignsDue: 0, contactsDue: 0, skippedCallHours: 0, skippedConcurrency: 0 });

// Tenant-facing responses carry a word, never the env name or a raw exception.
const status = readFileSync(new URL("../../app/api/dashboard/campaigns/[id]/status/route.ts", import.meta.url), "utf8");
assert.match(status, /dispatch = \{ error: "dispatch_failed" \}/);
assert.doesNotMatch(status, /error: e instanceof Error \? e\.message/);

console.log("ALL CAMPAIGN-DISPATCH-MODE TESTS PASSED");
