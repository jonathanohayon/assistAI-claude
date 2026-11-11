// Unit tests for lib/mission (bricks M1 + M2a).
// Run with:  npx tsx scripts/tests/mission.test.ts
import assert from "node:assert/strict";

import { GOAL_PRESETS } from "../../lib/campaigns/constants";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { readFileSync } from "node:fs";

import { campaignGoalFields, missionForPreset, missionFromCampaign, OUTBOUND_TEST_MISSION, PRESET_TO_MISSION, receptionistMission } from "../../lib/mission/adapters";
import { SALES_MISSION_TABLE, SALES_MISSIONS } from "../../lib/mission/contract";
import { CAPABILITY_KEYS } from "../../lib/tools/contract";
import { goldenCases } from "./fixtures/campaign-instructions-cases";
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
  assert.equal(m.preset, goalPreset, "the raw stored preset is kept as is");
  assert.deepEqual(m.requires, [], "no mapped preset requires a capability");
  assert.deepEqual(m.capture, c.extractionSchema);
  assert.deepEqual(campaignGoalFields(m), { goalPreset, objective: c.objective, successCriteria: c.successCriteria });
}
assert.deepEqual(missionFromCampaign({ goalPreset: "custom", objective: "", successCriteria: "", extractionSchema: null }).capture, []);
// The outbound test keeps what its route always used.
assert.deepEqual(campaignGoalFields(OUTBOUND_TEST_MISSION), { goalPreset: "sales", objective: "", successCriteria: "" });
assert.equal(OUTBOUND_TEST_MISSION.kind, "announce_offer");
assert.equal(OUTBOUND_TEST_MISSION.cold, false);

// ── M2a: today's preset → sales mission (mapping to confirm by tamaraVP) ──
const kindOf = (goalPreset: string) =>
  missionFromCampaign({ goalPreset, objective: "", successCriteria: "", extractionSchema: [] });
assert.deepEqual([kindOf("cold").kind, kindOf("cold").cold], ["qualify_lead", true], "cold = qualify_lead + cold");
assert.deepEqual([kindOf("lead_gen").kind, kindOf("lead_gen").cold], ["qualify_lead", false]);
assert.deepEqual([kindOf("sales").kind, kindOf("sales").cold], ["announce_offer", false]);
assert.deepEqual([kindOf("marketing").kind, kindOf("marketing").cold], ["announce_offer", false]);
assert.deepEqual([kindOf("custom").kind, kindOf("custom").cold], ["other", false]);
for (const unknown of ["legacy_unknown", "", "appointment", "qualify", "toString", "__proto__", "COLD"]) {
  const m = kindOf(unknown);
  assert.deepEqual([m.kind, m.cold, m.preset], ["other", false, unknown], `unknown preset ${JSON.stringify(unknown)} → other, preset kept`);
}
assert.deepEqual(Object.keys(PRESET_TO_MISSION).sort(), [...GOAL_PRESETS].sort(), "every preset is mapped");
assert.deepEqual(missionForPreset("cold"), { kind: "qualify_lead", cold: true });

// ── M2a: the five sales missions ──
assert.deepEqual([...SALES_MISSIONS], ["qualify_lead", "book_for_seller", "announce_offer", "follow_up", "other"]);
assert.deepEqual(Object.keys(SALES_MISSION_TABLE), [...SALES_MISSIONS]);
assert.equal((SALES_MISSIONS as readonly string[]).includes("cold"), false, "cold prospecting is not a sixth mission");
const T = SALES_MISSION_TABLE;
assert.deepEqual(T.qualify_lead, { requires: { all: [], anyOf: [], optional: [] }, provenBy: "lead_sheet_complete", measurable: true, allowsCold: true });
assert.deepEqual(T.book_for_seller, { requires: { all: ["booking"], anyOf: [], optional: [] }, provenBy: "booking_created", measurable: true, allowsCold: false });
assert.deepEqual(T.announce_offer, { requires: { all: [], anyOf: [], optional: ["transfer"] }, provenBy: "transfer_or_callback", measurable: true, allowsCold: false });
assert.deepEqual(T.follow_up, { requires: { all: [], anyOf: ["booking", "transfer"], optional: [] }, provenBy: "booking_or_transfer", measurable: true, allowsCold: false });
assert.deepEqual(T.other, { requires: { all: [], anyOf: [], optional: [] }, provenBy: "estimated", measurable: false, allowsCold: false });
for (const k of SALES_MISSIONS) {
  for (const c of [...T[k].requires.all, ...T[k].requires.anyOf, ...T[k].requires.optional]) {
    assert.ok((CAPABILITY_KEYS as readonly string[]).includes(c), `${k}: ${c} is a CapabilityKey`);
  }
}

// ── M2a: the instructions are byte-identical to origin/main, every preset ──
{
  const golden = JSON.parse(readFileSync(new URL("./fixtures/campaign-instructions-golden.json", import.meta.url), "utf8")) as Record<string, string>;
  const now = goldenCases();
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) assert.equal(now[k], golden[k], `instructions unchanged: ${k}`);
  assert.equal(Object.keys(golden).length, 37);
}

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
// M2a: every outbound mission stays not_measured (measuring by tools is M4b).
for (const kind of SALES_MISSIONS) {
  for (const cold of [false, true]) {
    const m = { ...OUTBOUND_TEST_MISSION, kind, cold };
    for (const events of [[], [{ event: "book_success" }], [{ event: "call_transfer", metadata: { ok: true } }]]) {
      assert.deepEqual(missionOutcome(m, events), { status: "not_measured" }, `${kind}${cold ? " cold" : ""}`);
    }
  }
}
assert.deepEqual(missionOutcome({ ...OUTBOUND_TEST_MISSION, kind: null }, [{ event: "book_success" }]), { status: "not_measured" });

console.log("ALL MISSION TESTS PASSED");
