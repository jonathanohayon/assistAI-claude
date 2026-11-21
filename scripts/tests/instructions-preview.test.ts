// Prompt preview shapes (tamaraVP's rule): the tenant shape contains ONLY the
// tenant's own sections, each equal to the corresponding section of the real
// instructions, and never any admin directive text. Mock data only.
// Run with:  npx tsx scripts/tests/instructions-preview.test.ts

import assert from "node:assert/strict";

import {
  BLOCK_SEPARATOR,
  inboundSessionInstructions,
  inboundSessionSections,
  inboundTenantSections,
  outboundSessionInstructions,
} from "../../lib/agent/session-instructions";
import { substituteVars } from "../../lib/campaigns/prompt";

const ADMIN_TEXTS = ["Mock ADMIN time rule.", "Mock ADMIN phone rule.", "Mock ADMIN hangup rule.", "Mock ADMIN config blocks.", "Mock ADMIN global rule.", "Mock ADMIN capabilities."];
const directives = {
  globalByPlan: { premium: ADMIN_TEXTS[4] },
  spokenTimeByPlan: { premium: ADMIN_TEXTS[0] },
  spokenPhoneByPlan: { premium: ADMIN_TEXTS[1] },
  hangupByPlan: { premium: ADMIN_TEXTS[2] },
  configBlocksByPlan: { premium: ADMIN_TEXTS[3] },
  blockOrderByPlan: { premium: ["spoken_time", "spoken_phone", "hangup", "config_blocks", "persona", "knowledge", "language", "admin_global"] },
  capabilitiesByPlan: { premium: ADMIN_TEXTS[5] },
};
const H = { open: true, openTime: "09:00", closeTime: "18:00" };
const business = {
  identity: { name: "Salon Mock", tagline: "", email: "" },
  centres: [{ id: "c1", name: "Mock North", address: "", hours: { sun: H, mon: H, tue: H, wed: H, thu: H, fri: H, sat: H } }],
  services: [], centresRules: "", knowledgeBase: "",
};
const input = {
  config: { inheritAdminGlobals: true, primaryLanguage: "fr", personaConfig: null, business, instructions: "Mock tenant instructions.", knowledge: null, voiceProfile: null },
  planKey: "premium",
  directives,
  capabilities: { calendar: true, crm: true, orders: false },
};

// inbound: each tenant section IS a section of the real output
{
  const full = inboundSessionInstructions(input);
  const blocks = full.split(BLOCK_SEPARATOR);
  const own = inboundTenantSections(input);
  assert.ok(blocks.includes(own.companySheet), "company sheet = a section of the real text");
  assert.ok(blocks.includes(own.instructions), "instructions = a section of the real text");
  assert.equal(own.instructions, "Mock tenant instructions.");
  assert.match(own.companySheet, /Salon Mock/);
  const sections = inboundSessionSections(input);
  assert.equal(own.companySheet, sections.blocks.knowledge);
  // admin text is in the full text but never in the tenant shape
  for (const t of ADMIN_TEXTS) {
    assert.ok(full.includes(t), `full has ${t}`);
    assert.ok(!JSON.stringify(own).includes(t), `tenant shape must not carry: ${t}`);
  }
  assert.doesNotMatch(JSON.stringify(own), /RÈGLES TRANSVERSES|LANGUE PAR DÉFAUT/);
}

// outbound: tenant parts appear verbatim in the real text; the admin framing never in them
{
  const framings = { sales: "Mock ADMIN sales framing." };
  const persona = { agentName: "Dana", instructions: "  Mock agent instructions {{name}}.  ", knowledge: " Mock learned facts. " };
  const full = outboundSessionInstructions({
    campaign: { goalPreset: "sales", objective: "", persona },
    contact: {},
    framings,
    primaryLanguage: "fr",
    spokenLanguages: [],
    baseGreeting: "",
    disclosure: { enabled: false, text: "" },
  });
  const knowledge = substituteVars(persona.knowledge.trim(), {});
  const instructions = substituteVars(persona.instructions.trim(), {});
  assert.ok(full.includes(knowledge) && full.includes(`CONSIGNES :\n${instructions}`), "parts are as the agent receives them");
  assert.equal(instructions, "Mock agent instructions .", "variables substituted as in the real text");
  assert.ok(full.includes("Mock ADMIN sales framing."));
  assert.ok(![knowledge, instructions].join(" ").includes("Mock ADMIN"), "no admin framing in the tenant parts");
}

console.log("ALL INSTRUCTIONS-PREVIEW TESTS PASSED");
