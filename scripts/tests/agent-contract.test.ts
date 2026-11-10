// Agent contract adapters (lib/agent/adapters.ts): agent vs ACCOUNT settings
// separated; a campaign without an agent = today's defaults. Route-level
// identity per origin: scripts/agent-resolution-check.ts (see the A1 PR).
// Run with:  npx tsx scripts/tests/agent-contract.test.ts

import assert from "node:assert/strict";

import { accountFrom, agentFromOutbound, agentFromReceptionist } from "../../lib/agent/adapters";

const cfg = {
  id: "00000000-0000-0000-0000-0000000000f1", userId: "00000000-0000-0000-0000-00000000000a",
  voice: "cedar", model: "gpt-realtime-2", speed: 1.13, realtimeProvider: "xai", voiceProfile: null, noiseReductionLevel: 6,
  agentName: "Tamara", primaryLanguage: "he", greetingInstructions: "שלום!", aiDisclosureEnabled: true, aiDisclosureText: "",
  personaConfig: { version: 1, name: "Tamara", primaryLanguage: "he", greeting: { mode: "custom", text: "שלום!" }, languages: ["en"], aiDisclosure: { enabled: true, text: "" } },
  instructions: "Mock persona.", business: null, knowledge: null,
  ownerWhatsapp: "+972500000000", transferNumber: "+97230000000", reminderEnabled: true, ownerDigestEnabled: false,
  forwardingVerifiedAt: new Date("2026-11-10T10:00:00Z"),
};
const user = { id: cfg.userId, displayName: "Salon Mock", subscriptionPlan: "premium", companySheet: null };

const agent = agentFromReceptionist(cfg);
assert.equal(agent.recipe, "receptionist");
assert.equal(agent.id, cfg.id);
assert.equal(agent.accountId, cfg.userId);
assert.equal(agent.voice.engine, "xai");
assert.equal(agent.voice.advanced.speed, 1.13);
assert.deepEqual(agent.persona.languages, ["en"], "stored spoken languages, as calls read them");
assert.equal(agent.knowledge.instructions, "Mock persona.");
// the agent carries NO account setting…
const agentJson = JSON.stringify(agent);
for (const v of ["+972500000000", "+97230000000", "Salon Mock"]) assert.ok(!agentJson.includes(v), `agent must not carry ${v}`);
// …the account carries them
const acct = accountFrom(user, cfg);
assert.deepEqual(
  { ownerWhatsapp: acct.ownerWhatsapp, transferNumber: acct.transferNumber, reminderEnabled: acct.reminderEnabled, ownerDigestEnabled: acct.ownerDigestEnabled, businessName: acct.businessName, plan: acct.plan },
  { ownerWhatsapp: "+972500000000", transferNumber: "+97230000000", reminderEnabled: true, ownerDigestEnabled: false, businessName: "Salon Mock", plan: "premium" },
);
assert.equal(acct.forwardingVerifiedAt, "2026-11-10T10:00:00.000Z");
// an account without an agent_configs row (outbound-only paths)
assert.equal(accountFrom(user, null).transferNumber, "");

// campaign without an agent = today's defaults
const def = agentFromOutbound(null, cfg.userId);
assert.equal(def.id, null);
assert.equal(def.persona.name, "Sarah");
assert.equal(def.persona.primaryLanguage, "fr");
assert.equal(def.voice.voiceId, "marin");
assert.equal(def.persona.aiDisclosure.enabled, false);
assert.equal(def.legacyAgentFacts, "");

console.log("ALL AGENT-CONTRACT TESTS PASSED");
