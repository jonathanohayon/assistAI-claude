// The session instructions builders (lib/agent/session-instructions.ts) —
// route-level identity is proven by the real-handler snapshots in the PR.
// Run with:  npx tsx scripts/tests/session-instructions.test.ts

import assert from "node:assert/strict";

import { BLOCK_SEPARATOR, inboundSessionInstructions, outboundSessionInstructions } from "../../lib/agent/session-instructions";
import { buildCampaignInstructions } from "../../lib/campaigns/prompt";

const directives = {
  globalByPlan: { premium: "Mock global rule." },
  spokenTimeByPlan: { premium: "Mock time rule." },
  spokenPhoneByPlan: { premium: "Mock phone rule." },
  hangupByPlan: { premium: "Mock hangup rule." },
  configBlocksByPlan: { premium: "Mock config blocks." },
  blockOrderByPlan: { premium: ["spoken_time", "spoken_phone", "hangup", "config_blocks", "persona", "knowledge", "language", "admin_global"] },
  capabilitiesByPlan: { premium: "Calendar: {calendar}." },
};
const config = { inheritAdminGlobals: true, primaryLanguage: "fr", personaConfig: null, business: null, instructions: "Mock persona.", knowledge: null, voiceProfile: null };
const caps = { calendar: true, crm: false, orders: false };

{
  const out = inboundSessionInstructions({ config, planKey: "premium", directives, capabilities: caps });
  const blocks = out.split(BLOCK_SEPARATOR);
  assert.equal(blocks[0], "Mock time rule.");
  assert.equal(blocks[4], "Mock persona.");
  assert.match(blocks[5]!, /^LANGUE PAR DÉFAUT DU TENANT : français/);
  assert.match(blocks[6]!, /^RÈGLES TRANSVERSES ADDITIONNELLES \(à appliquer EN COMPLÉMENT du persona, jamais à sa place\) :\n\nMock global rule\.$/);
  assert.equal(blocks.length, 8, "empty knowledge block is dropped; capabilities last");
}
// inheritAdminGlobals=false → admin blocks blanked (persona, language, capabilities remain)
{
  const out = inboundSessionInstructions({ config: { ...config, inheritAdminGlobals: false }, planKey: "premium", directives, capabilities: caps });
  assert.doesNotMatch(out, /Mock (time|phone|hangup|global) rule|Mock config blocks/);
  assert.equal(out.split(BLOCK_SEPARATOR).length, 3);
}
// unknown plan → no block order → capabilities only (the default template)
assert.ok(inboundSessionInstructions({ config, planKey: "unknown", directives, capabilities: caps }).length > 0);

// outbound: no languages, disclosure off = buildCampaignInstructions verbatim
{
  const campaign = { goalPreset: "sales", objective: "", persona: { agentName: "Dana", instructions: "x" } };
  const base = buildCampaignInstructions(campaign, { contactName: "Mock Contact" }, undefined);
  assert.equal(
    outboundSessionInstructions({ campaign, contact: { contactName: "Mock Contact" }, framings: undefined, primaryLanguage: "fr", spokenLanguages: [], baseGreeting: "", disclosure: { enabled: false, text: "" } }),
    base,
  );
  const on = outboundSessionInstructions({ campaign, contact: {}, framings: undefined, primaryLanguage: "fr", spokenLanguages: ["en"], baseGreeting: "", disclosure: { enabled: true, text: "" } });
  assert.match(on, /LANGUES PARLÉES : français \(fr\), anglais \(US\) \(en\)/);
  assert.match(on, /ANNONCE IA/);
}

console.log("ALL SESSION-INSTRUCTIONS TESTS PASSED");
