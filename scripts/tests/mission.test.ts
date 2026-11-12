// Unit tests for lib/mission (bricks M1 + M2a).
// Run with:  npx tsx scripts/tests/mission.test.ts
import assert from "node:assert/strict";

import { GOAL_PRESETS } from "../../lib/campaigns/constants";
import { buildCampaignInstructions, DEFAULT_GOAL_FRAMINGS } from "../../lib/campaigns/prompt";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { readFileSync } from "node:fs";

import { campaignGoalFields, missionForPreset, missionFromCampaign, OUTBOUND_TEST_MISSION, PRESET_TO_MISSION, presetForMission, receptionistMission } from "../../lib/mission/adapters";
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
  assert.deepEqual(m.requires, goalPreset === "book_for_seller" ? ["booking"] : [], "only book_for_seller requires a capability (booking)");
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
// M2d: one preset per mission, never cold.
assert.deepEqual([kindOf("book_for_seller").kind, kindOf("book_for_seller").cold], ["book_for_seller", false]);
assert.deepEqual([kindOf("follow_up").kind, kindOf("follow_up").cold], ["follow_up", false]);
assert.deepEqual(kindOf("follow_up").requires, [], "follow_up needs no tool (anyOf only, not enforced)");
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
  // The 37 M2a goldens first (captured on origin/main before M2d), then one per M2d preset.
  assert.equal(Object.keys(golden).length, 39);
  assert.deepEqual(Object.keys(golden).slice(37), ["book_for_seller default", "follow_up default"]);
  assert.ok(golden["book_for_seller default"].includes(DEFAULT_GOAL_FRAMINGS.book_for_seller));
  assert.ok(golden["follow_up default"].includes(DEFAULT_GOAL_FRAMINGS.follow_up));
}

// ── M2d: the two framings, byte-exact (tamaraVP's text) ──
{
  assert.equal(
    DEFAULT_GOAL_FRAMINGS.book_for_seller,
    "Tu passes un appel SORTANT pour fixer un rendez-vous avec un conseiller. Annonce en une phrase qui tu es et pourquoi tu appelles, puis vérifie que la personne est concernée par l'offre. Dès qu'elle montre de l'intérêt, PROPOSE deux créneaux précis et réserve celui qu'elle choisit. Tu ne vends pas toi-même et tu ne donnes pas de prix détaillé : ton seul but est le rendez-vous. Répète la date et l'heure avant de raccrocher. Si aucun créneau ne convient, propose qu'un conseiller la rappelle et note le moment qui l'arrange.",
  );
  assert.equal(
    DEFAULT_GOAL_FRAMINGS.follow_up,
    "Tu passes un appel SORTANT de suivi auprès d'une personne qui connaît déjà l'entreprise. Rappelle en une phrase le dernier échange ou le service utilisé, sans réciter son dossier. Demande où elle en est, écoute, puis propose UNE suite concrète : un rendez-vous ou un échange avec un conseiller. Tu ne présentes pas l'entreprise comme à un inconnu et tu n'insistes pas après un refus clair.",
  );
  for (const p of ["book_for_seller", "follow_up"] as const) {
    const t = DEFAULT_GOAL_FRAMINGS[p];
    assert.ok(!/[\u2019\u00a0\u202f]/.test(t), `${p}: straight apostrophes, plain spaces`);
    assert.ok(t.includes(" : "), `${p}: a plain space before the colon`);
    assert.equal(t, t.normalize("NFC"), `${p}: NFC`);
  }
  // Admin-editable through the same framings map: an override wins, blank → the default.
  const c = { goalPreset: "follow_up", objective: "", persona: {} };
  assert.ok(buildCampaignInstructions(c, {}, { follow_up: "Framing suivi ADMIN mock." }).includes("Framing suivi ADMIN mock."));
  assert.ok(buildCampaignInstructions(c, {}, { follow_up: "  " }).includes(DEFAULT_GOAL_FRAMINGS.follow_up));
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

// ── presetForMission: agent's default mission → a new campaign's preset ──
assert.equal(presetForMission({ kind: "qualify_lead", cold: true }), "cold");
assert.equal(presetForMission({ kind: "qualify_lead", cold: false }), "lead_gen");
assert.equal(presetForMission({ kind: "announce_offer", cold: false }), "sales");
assert.equal(presetForMission({ kind: "other", cold: false }), "custom");
assert.equal(presetForMission({ kind: "book_for_seller", cold: false }), "book_for_seller");
assert.equal(presetForMission({ kind: "follow_up", cold: false }), "follow_up");
for (const kind of SALES_MISSIONS) assert.notEqual(presetForMission({ kind, cold: false }), null, `${kind} has a preset (M2d)`);
assert.equal(presetForMission(null), null);
for (const kind of SALES_MISSIONS) assert.notEqual(presetForMission({ kind, cold: false }), undefined, `${kind} is handled`);
// round-trip for every preset except "marketing"
for (const p of GOAL_PRESETS) {
  if (p === "marketing") continue;
  assert.equal(presetForMission(missionForPreset(p)), p, `round-trip ${p}`);
}
// lossy by design (read side only): marketing reads as announce_offer and comes back as sales
assert.deepEqual(missionForPreset("marketing"), { kind: "announce_offer", cold: false });
assert.equal(presetForMission(missionForPreset("marketing")), "sales");

console.log("ALL MISSION TESTS PASSED");
