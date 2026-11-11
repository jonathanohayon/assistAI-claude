// Unit tests for lib/mission (brick M1).
// Run with:  npx tsx scripts/tests/mission.test.ts
import assert from "node:assert/strict";

import { GOAL_PRESETS } from "../../lib/campaigns/constants";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { campaignGoalFields, missionFromCampaign, OUTBOUND_TEST_MISSION, receptionistMission } from "../../lib/mission/adapters";
import { missionOutcome } from "../../lib/mission/measure";
import { toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities } from "../../lib/tools/contract";

// Campaign → Mission → the builder's goal fields: lossless, for every preset
// (and a value outside the list, kept as stored).
for (const goalPreset of [...GOAL_PRESETS, "legacy_unknown"]) {
  const c = {
    goalPreset,
    objective: "Proposer l'offre d'automne",
    successCriteria: "Un rendez-vous est pris",
    extractionSchema: [{ key: "budget", label: "Budget", type: "number" as const }],
  };
  const m = missionFromCampaign(c);
  assert.equal(m.kind, null, "sales mission kinds are decided in M2");
  assert.deepEqual(m.capture, c.extractionSchema);
  assert.deepEqual(campaignGoalFields(m), { goalPreset, objective: c.objective, successCriteria: c.successCriteria });
}
assert.deepEqual(missionFromCampaign({ goalPreset: "custom", objective: "", successCriteria: "", extractionSchema: null }).capture, []);
// The outbound test keeps what its route always used.
assert.deepEqual(campaignGoalFields(OUTBOUND_TEST_MISSION), { goalPreset: "sales", objective: "", successCriteria: "" });

// Receptionist: implicit, from what its calls can do.
const caps = (calendar: boolean) =>
  effectiveCapabilities(
    { recipe: "receptionist", tools: toolsFromTileToggles({ calendar, customers: true, orders: false }) },
    { transferNumber: "", googleConnected: true },
    DEFAULT_MATRIX.premium,
  );
const book = receptionistMission(caps(true));
assert.equal(book.kind, "inform_and_book");
assert.equal(book.implicit, true);
assert.deepEqual(book.requires, ["booking"]);
const msg = receptionistMission(caps(false));
assert.equal(msg.kind, "take_messages");
assert.deepEqual(msg.requires, []);

// Success from TOOL EVENTS only — never from what was said.
assert.deepEqual(missionOutcome(book, [{ event: "book_success" }]), { status: "achieved", by: "book_success" });
assert.deepEqual(missionOutcome(book, [{ event: "reschedule_success" }]), { status: "achieved", by: "reschedule_success" });
assert.deepEqual(missionOutcome(book, [{ event: "cancel_success" }]), { status: "achieved", by: "cancel_success" });
assert.deepEqual(missionOutcome(book, []), { status: "not_achieved" }, "a summary saying 'RDV pris' proves nothing");
assert.deepEqual(missionOutcome(book, [{ event: "book_wrong_center" }, { event: "book_conflict" }]), { status: "not_achieved" });
assert.deepEqual(missionOutcome(book, [{ event: "call_transfer", metadata: { ok: true } }]), { status: "not_achieved" });
assert.deepEqual(missionOutcome(msg, [{ event: "book_success" }]), { status: "not_measured" });
assert.deepEqual(missionOutcome(missionFromCampaign({ goalPreset: "sales", objective: "", successCriteria: "", extractionSchema: [] }), [{ event: "book_success" }]), {
  status: "not_measured",
});

console.log("ALL MISSION TESTS PASSED");
