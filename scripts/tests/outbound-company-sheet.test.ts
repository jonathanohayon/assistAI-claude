// Knowledge S5: outbound agents read the account's company sheet, shipped
// OFF behind a server-side switch. Mock data only.
// Run with:  npx tsx scripts/tests/outbound-company-sheet.test.ts

import assert from "node:assert/strict";

import { EMPTY_COMPANY_SHEET, type CompanySheet } from "../../lib/knowledge/contract";
import { outboundKnowledgeText, outboundSheetEnabled, renderSheetForOutbound } from "../../lib/knowledge/outbound-sheet";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

// switch: off by default; "all"; a list of account ids
assert.equal(outboundSheetEnabled(A, {}), false);
assert.equal(outboundSheetEnabled(A, { OUTBOUND_COMPANY_SHEET: "  " }), false);
assert.equal(outboundSheetEnabled(A, { OUTBOUND_COMPANY_SHEET: "all" }), true);
assert.equal(outboundSheetEnabled(A, { OUTBOUND_COMPANY_SHEET: ` ${B} , ${A} ` }), true);
assert.equal(outboundSheetEnabled(A, { OUTBOUND_COMPANY_SHEET: B }), false, "other account only");

// OFF (sheet null) = the agent's own text, byte-identical
for (const t of ["", "  ", "Mock learned knowledge."]) assert.equal(outboundKnowledgeText(t, null), t);
// ON with an empty sheet = unchanged too
assert.equal(outboundKnowledgeText("Mock learned knowledge.", EMPTY_COMPANY_SHEET), "Mock learned knowledge.");

// ON: account facts + the agent's own text
const H = { open: true, openTime: "09:00", closeTime: "18:00" };
const C = { open: false, openTime: "09:00", closeTime: "18:00" };
const sheet: CompanySheet = {
  ...EMPTY_COMPANY_SHEET,
  identity: { name: "Salon Mock", tagline: "", email: "hello@example.test" },
  locations: [{ id: "c1", name: "Mock North", address: "1 Mock St", hours: { sun: H, mon: H, tue: H, wed: C, thu: H, fri: C, sat: C } }],
  services: [
    { id: "s1", name: "Mock Cut", durationMinutes: 30, priceILS: 120, locationIds: "all", description: "" },
    { id: "s2", name: "Mock Colour", durationMinutes: 60, priceILS: 300, locationIds: ["c1"], description: "long hair" },
  ],
  locationRules: "North closed on Wednesdays.",
  notes: "Mock notes.",
  faq: [{ q: "Parking?", a: "Yes." }],
};
const facts = renderSheetForOutbound(sheet);
for (const piece of ["Nom : Salon Mock", "Mock North (1 Mock St) : Dim 09:00–18:00", "Mer fermé", "Mock Cut : 120 ₪, 30 min", "Mock Colour : 300 ₪, 60 min — Mock North — long hair", "North closed on Wednesdays.", "Mock notes.", "Q : Parking?"]) {
  assert.ok(facts.includes(piece), `facts include: ${piece}`);
}
assert.doesNotMatch(facts, /list_centres|get_opening_hours|find_service/, "no inbound-only tool names in an outbound prompt");
assert.equal(outboundKnowledgeText("Mock learned.", sheet), `${facts}\n\nCONNAISSANCES PROPRES À CET AGENT :\nMock learned.`);
assert.equal(outboundKnowledgeText("  ", sheet), facts);
assert.equal(renderSheetForOutbound(EMPTY_COMPANY_SHEET), "");

console.log("ALL OUTBOUND-COMPANY-SHEET TESTS PASSED");
