// What a campaign PATCH may change by status (lib/campaigns/patch-plan.ts).
// Run with:  npx tsx scripts/tests/campaign-patch-plan.test.ts

import assert from "node:assert/strict";

import { planCampaignPatch } from "../../lib/campaigns/patch-plan";
import { normalizeCallWindow, normalizeRetryRules } from "../../lib/campaigns/validate";

const stored = {
  goalPreset: "custom",
  objective: "Mock objective",
  successCriteria: "",
  agentId: "00000000-0000-0000-0000-0000000000a1",
  extractionSchema: [],
  concurrency: 2,
  retryRules: normalizeRetryRules({ maxAttempts: 2, retryOn: ["no_answer", "busy"], backoffMinutes: 60 }),
  callWindow: normalizeCallWindow({ timezone: "Asia/Jerusalem", days: [0, 1, 2, 3, 4], startHour: 9, endHour: 18 }),
  fromNumber: "+97220000000",
};
// The workspace sends the WHOLE draft (keys/arrays possibly in another order).
const draft = {
  name: "Mock campaign",
  ...stored,
  callWindow: { days: [4, 3, 2, 1, 0], endHour: 18, startHour: 9, timezone: "Asia/Jerusalem", respectDnc: true },
  retryRules: { backoffMinutes: 60, retryOn: ["busy", "no_answer"], maxAttempts: 2 },
};
const later = { ...draft, callWindow: { ...draft.callWindow, endHour: 20 } };

// running + whole draft, only the end hour changed → applied (the reported bug)
{
  const p = planCampaignPatch({ status: "running", ...stored }, later);
  assert.equal(p.ok, true);
  assert.deepEqual(Object.keys(p.ok ? p.changes : {}), ["callWindow"]);
  assert.equal(p.ok && (p.changes.callWindow as { endHour: number }).endHour, 20);
}
// running + whole draft, nothing changed → ok, no structural change (no false 409)
{
  const p = planCampaignPatch({ status: "running", ...stored }, draft);
  assert.deepEqual(p, { ok: true, changes: {} });
}
// running + agent changed → 409 pause_to_edit, nothing applied (even with the window change)
{
  const p = planCampaignPatch(
    { status: "running", ...stored },
    { ...later, agentId: "00000000-0000-0000-0000-0000000000a2" },
  );
  assert.deepEqual(p, { ok: false, error: "pause_to_edit", fields: ["agentId"] });
}
// running + several structural changes → all listed
{
  const p = planCampaignPatch(
    { status: "running", ...stored },
    { concurrency: 5, fromNumber: " +97230000000 ", objective: "Other" },
  );
  assert.deepEqual(p, { ok: false, error: "pause_to_edit", fields: ["objective", "concurrency", "fromNumber"] });
}
// running + only callWindow in the body → applied
{
  const p = planCampaignPatch({ status: "running", ...stored }, { callWindow: { ...stored.callWindow, days: [0, 1, 2, 3, 4, 5] } });
  assert.equal(p.ok && Object.keys(p.changes).join(), "callWindow");
}
// draft / paused → everything editable
for (const status of ["draft", "paused"]) {
  const p = planCampaignPatch({ status, ...stored }, { agentId: null, concurrency: 4, callWindow: later.callWindow });
  assert.equal(p.ok, true, status);
  assert.deepEqual(Object.keys(p.ok ? p.changes : {}).sort(), ["agentId", "callWindow", "concurrency"], status);
}
// completed → no structural change, but an unchanged full save is fine
assert.deepEqual(planCampaignPatch({ status: "completed", ...stored }, later), {
  ok: false,
  error: "campaign_not_editable",
  fields: ["callWindow"],
});
assert.deepEqual(planCampaignPatch({ status: "completed", ...stored }, draft), { ok: true, changes: {} });
// invalid types are ignored as before (not treated as a change)
assert.deepEqual(planCampaignPatch({ status: "running", ...stored }, { objective: 42, fromNumber: null }), {
  ok: true,
  changes: {},
});

console.log("ALL CAMPAIGN-PATCH-PLAN TESTS PASSED");
