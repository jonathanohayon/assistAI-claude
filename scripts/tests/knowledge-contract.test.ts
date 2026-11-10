// Knowledge contract v1 (lib/knowledge/*). PROOF: the text sent to the agent
// is identical to today's, inbound and outbound (also proven at route level by
// scripts/voice-route-snapshot.ts runs, see the S1 PR). Mock data only.
// Run with:  npx tsx scripts/tests/knowledge-contract.test.ts

import assert from "node:assert/strict";

import { renderBusinessPromptBlock, sanitizeBusinessConfig } from "../../lib/business";
import { buildCampaignInstructions } from "../../lib/campaigns/prompt";
import { businessFromSheet, knowledgeFromInbound, knowledgeFromOutbound, sheetFromBusiness } from "../../lib/knowledge/adapters";
import {
  EMPTY_COMPANY_SHEET,
  KNOWLEDGE_FIELD_LEVEL,
  parseAgentKnowledge,
  parseCompanySheet,
} from "../../lib/knowledge/contract";
import { inboundInstructionsBlock, inboundKnowledgeBlock, outboundKnowledgeParts } from "../../lib/knowledge/render";

const H = { open: true, openTime: "09:00", closeTime: "18:00" };
const C = { open: false, openTime: "09:00", closeTime: "18:00" };
const hours = { sun: H, mon: H, tue: H, wed: C, thu: H, fri: C, sat: C };
const business = {
  identity: { name: "Salon Mock", tagline: "Mock tagline", email: "hello@example.test" },
  centres: [
    { id: "c1", name: "Mock Centre North", address: "1 Mock St", hours },
    { id: "c2", name: "Mock Centre South", address: "", hours },
  ],
  services: [
    { id: "s1", name: "Mock Cut", durationMinutes: 30, priceILS: 120, centreIds: "all", description: "x" },
    { id: "s2", name: "Mock Colour", durationMinutes: 60, priceILS: 300, centreIds: ["c2"], description: "" },
  ],
  centresRules: "South on Wednesdays only.",
  knowledgeBase: "Mock expertise notes.",
};
const legacy = [{ businessName: "Mock Legacy", openingHours: "9-18", description: "Legacy details" }, { businessName: "", description: "" }];

// ── Today's inbound knowledge block, written out from /api/agent/config ──
function todayInbound(raw: unknown, legacyArr: unknown): string {
  const b = raw as { identity?: { name?: string }; centres?: unknown[]; services?: unknown[] } | null;
  if (b && typeof b === "object" && ((b.identity?.name ?? "").length > 0 || (b.centres?.length ?? 0) > 0 || (b.services?.length ?? 0) > 0)) {
    return renderBusinessPromptBlock(sanitizeBusinessConfig(b));
  }
  if (Array.isArray(legacyArr) && legacyArr.length > 0) {
    const e = (legacyArr as Array<{ businessName?: string; openingHours?: string; description?: string }>).filter(
      (x) => (x?.businessName?.length ?? 0) > 0 || (x?.description?.length ?? 0) > 0,
    );
    if (e.length) {
      return `BUSINESS — INFOS LEGACY (sera migré vers structure complète au prochain save dashboard) :\n\n${e
        .map((x, i) => [`### ${i + 1}. ${x.businessName || "(sans nom)"}`, ...(x.openingHours ? [`Horaires : ${x.openingHours}`] : []), ...(x.description ? [`Détails : ${x.description}`] : [])].join("\n"))
        .join("\n\n")}`;
    }
  }
  return "";
}

const inboundCases: Array<[string, unknown, unknown]> = [
  ["full business", business, null],
  ["full business + legacy array (business wins)", business, legacy],
  ["only rules → raw condition false → legacy", { identity: { name: "", tagline: "", email: "" }, centres: [], services: [], centresRules: "Rules only." }, legacy],
  ["only knowledgeBase, no legacy → ''", { identity: { name: "" }, knowledgeBase: "kb" }, null],
  ["whitespace name (raw true, sanitized empty) → business render", { identity: { name: "  ", tagline: "t" } }, legacy],
  ["invalid centres only (raw true)", { centres: [{ id: "", name: "" }] }, null],
  ["no business, legacy only", null, legacy],
  ["nothing", null, null],
  ["empty legacy entries", null, [{ businessName: "", description: "" }]],
  ["business not an object", "x", legacy],
];
for (const [name, raw, legacyArr] of inboundCases) {
  const k = knowledgeFromInbound({ business: raw, instructions: "Mock persona.", knowledge: legacyArr });
  assert.equal(inboundKnowledgeBlock(k), todayInbound(raw, legacyArr), `inbound: ${name}`);
  assert.equal(inboundInstructionsBlock(k.agent), "Mock persona.");
}
assert.equal(inboundInstructionsBlock(knowledgeFromInbound({ business: null, instructions: null, knowledge: null }).agent), "");

// business ↔ sheet is lossless for everything the business JSON holds
{
  const b = sanitizeBusinessConfig(business);
  assert.deepEqual(businessFromSheet(sheetFromBusiness(b)), b);
  const sheet = sheetFromBusiness(b);
  assert.equal(parseCompanySheet(sheet).ok, true, "adapter output is a valid sheet");
  assert.equal(sheet.locations[1]!.name, "Mock Centre South");
  assert.deepEqual(sheet.services[1]!.locationIds, ["c2"]);
  assert.equal(sheet.locationRules, "South on Wednesdays only.");
  assert.equal(sheet.notes, "Mock expertise notes.");
}

// ── Outbound: what buildCampaignInstructions receives today ─────────────
for (const row of [
  { knowledge: "Mock learned knowledge.", knowledgeSources: ["https://example.test"], instructions: "Mock outbound instructions." },
  { knowledge: "", knowledgeSources: [], instructions: "" },
  { knowledge: "  only spaces  ", knowledgeSources: null, instructions: "  " },
]) {
  const parts = outboundKnowledgeParts(knowledgeFromOutbound(row));
  assert.deepEqual(parts, { knowledge: row.knowledge, instructions: row.instructions });
  const persona = { agentName: "Dana", ...parts };
  const today = { agentName: "Dana", knowledge: row.knowledge, instructions: row.instructions };
  assert.equal(
    buildCampaignInstructions({ goalPreset: "sales", objective: "Mock objective", persona }, {}),
    buildCampaignInstructions({ goalPreset: "sales", objective: "Mock objective", persona: today }, {}),
  );
}
{
  const k = knowledgeFromOutbound({ knowledge: "x", knowledgeSources: ["https://example.test", 3], instructions: "" });
  assert.deepEqual(k.sheet.sources, [{ url: "https://example.test", learnedAt: null }]);
  assert.equal(parseCompanySheet(k.sheet).ok, true);
  assert.deepEqual(knowledgeFromOutbound(null).sheet, EMPTY_COMPANY_SHEET);
}

// ── Contract ────────────────────────────────────────────────────────────
assert.equal(parseCompanySheet(EMPTY_COMPANY_SHEET).ok, true);
assert.equal(parseCompanySheet({ ...EMPTY_COMPANY_SHEET, extra: 1 }).ok, false, "strict");
assert.equal(parseCompanySheet({ ...EMPTY_COMPANY_SHEET, faq: [{ q: "Mock?", a: "Yes." }] }).ok, true);
assert.equal(parseCompanySheet({ ...EMPTY_COMPANY_SHEET, faq: [{ q: "", a: "x" }] }).ok, false);
assert.equal(parseAgentKnowledge({ version: 1, instructions: "x" }).ok, true);
assert.equal(parseAgentKnowledge({ version: 1, instructions: "x", inheritAdminGlobals: true }).ok, false, "admin directives are not in the brick");
assert.equal(KNOWLEDGE_FIELD_LEVEL["agent.instructions"], 1);
assert.equal(KNOWLEDGE_FIELD_LEVEL["sheet.faq"], 2);

console.log("ALL KNOWLEDGE-CONTRACT TESTS PASSED");
