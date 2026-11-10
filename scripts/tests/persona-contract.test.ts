// Persona contract v1 (lib/persona/*). PROOF: building `persona` from
// today's columns and translating it gives EXACTLY the agent name, language
// and first sentence the routes send the engine today, for inbound
// (/api/agent/config) and outbound (campaign-config, outbound-test-config).
// Mock data only. Run with:  npx tsx scripts/tests/persona-contract.test.ts

import assert from "node:assert/strict";

import { effectiveGreeting } from "../../lib/ai-disclosure";
import { buildCampaignGreeting } from "../../lib/campaigns/prompt";
import { personaFromInbound, personaFromOutbound } from "../../lib/persona/adapters";
import {
  DEFAULT_PERSONA,
  mergePersona,
  parsePersona,
  PERSONA_FIELD_LEVEL,
} from "../../lib/persona/contract";
import { personaToInbound, personaToOutbound } from "../../lib/persona/engine";

// ── Inbound: what /api/agent/config sends today ─────────────────────────
// agentName and primaryLanguage come from the row spread; the greeting is
// effectiveGreeting(config, displayName) — the single source, unchanged.
type InRow = {
  agentName: string; primaryLanguage: string; greetingInstructions: string;
  aiDisclosureEnabled: boolean; aiDisclosureText: string;
};
const inboundToday = (row: InRow, business: string) => ({
  agentName: row.agentName,
  primaryLanguage: row.primaryLanguage,
  greetingInstructions: effectiveGreeting(row, business),
});
const inboundRows: Array<[InRow, string]> = [
  // column defaults: no greeting, disclosure on → default disclosure sentence
  [{ agentName: "", primaryLanguage: "fr", greetingInstructions: "", aiDisclosureEnabled: true, aiDisclosureText: "" }, "Salon Mock"],
  // custom greeting + agent name, disclosure inserted
  [{ agentName: "Tamara", primaryLanguage: "fr", greetingInstructions: "Bonjour, salon Mock ! Comment puis-je vous aider ?", aiDisclosureEnabled: true, aiDisclosureText: "" }, "Salon Mock"],
  // Hebrew, custom disclosure line
  [{ agentName: "תמרה", primaryLanguage: "he", greetingInstructions: "שלום, סלון מוק!", aiDisclosureEnabled: true, aiDisclosureText: "אני עוזרת וירטואלית, בינה מלאכותית." }, ""],
  // English, disclosure OFF → greeting verbatim
  [{ agentName: "Dana", primaryLanguage: "en", greetingInstructions: "Hi, Mock Clinic here.", aiDisclosureEnabled: false, aiDisclosureText: "" }, "Mock Clinic"],
  // whitespace-only greeting, disclosure OFF → '' (the model opens)
  [{ agentName: "Sarah", primaryLanguage: "fr", greetingInstructions: "   ", aiDisclosureEnabled: false, aiDisclosureText: "" }, "Salon Mock"],
  // greeting already says it's an AI → unchanged
  [{ agentName: "Tamara", primaryLanguage: "fr", greetingInstructions: "Bonjour, je suis l'assistante IA du salon Mock.", aiDisclosureEnabled: true, aiDisclosureText: "" }, "Salon Mock"],
];
for (const [i, [row, business]] of inboundRows.entries()) {
  const p = personaFromInbound(row);
  assert.equal(parsePersona(p).ok, true, `inbound ${i}: valid persona`);
  assert.deepEqual(personaToInbound(p, { businessName: business }), inboundToday(row, business), `inbound ${i}: identical`);
}
assert.equal(personaFromInbound(inboundRows[0]![0]).greeting.mode, "auto");
assert.equal(personaFromInbound(inboundRows[1]![0]).greeting.mode, "custom");
assert.equal(personaFromInbound(inboundRows[4]![0]).greeting.text, "   ", "text kept verbatim");
assert.deepEqual(personaFromInbound(inboundRows[0]![0]), DEFAULT_PERSONA, "column defaults = DEFAULT_PERSONA");

// ── Outbound: what campaign-config / outbound-test-config send today ────
type OutRow = { agentName: string; language: string; greeting: string };
const contact = { contactName: "Mock Contact", phoneNumber: "+97250000000", vars: { city: "Mockville" } };
const outboundToday = (agent: OutRow | null, c: typeof contact | Record<string, never>) => {
  const persona = agent
    ? { agentName: agent.agentName, language: agent.language, greeting: agent.greeting }
    : { agentName: "Sarah", language: "fr" };
  return {
    agentName: (persona.agentName || "Sarah").trim(),
    primaryLanguage: persona.language || "fr",
    greetingInstructions: buildCampaignGreeting({ persona }, c),
  };
};
const outboundRows: Array<OutRow | null> = [
  { agentName: "Sarah", language: "fr", greeting: "" }, // defaults → the model opens
  { agentName: "Dana", language: "he", greeting: "שלום {{name}}, כאן דנה." }, // variables
  { agentName: "  Noa  ", language: "en", greeting: "Hi {{name}} from {{city}}!" }, // trim + vars
  { agentName: "", language: "fr", greeting: "   " }, // empty name → Sarah, blank greeting
  null, // campaign without an agent
];
for (const [i, row] of outboundRows.entries()) {
  const p = personaFromOutbound(row);
  assert.equal(parsePersona(p).ok, true, `outbound ${i}: valid persona`);
  for (const c of [contact, {}] as const) {
    assert.deepEqual(personaToOutbound(p, c), outboundToday(row, c), `outbound ${i}: identical`);
  }
}
// outbound has no AI disclosure today (P5 ships it OFF)
assert.equal(personaFromOutbound(outboundRows[1]!).aiDisclosure.enabled, false);
// a language outside fr/he/en (only possible through the API, the editor
// offers fr/he/en) is read as fr
assert.equal(personaFromOutbound({ agentName: "x", language: "es", greeting: "" }).primaryLanguage, "fr");

// ── Contract rules ──────────────────────────────────────────────────────
assert.deepEqual(DEFAULT_PERSONA.languages, [], "no extra languages by default (P4)");
assert.equal(parsePersona({ ...DEFAULT_PERSONA, primaryLanguage: "de" }).ok, false);
assert.equal(parsePersona({ ...DEFAULT_PERSONA, languages: ["fr"] }).ok, false, "can't repeat the primary language");
assert.equal(parsePersona({ ...DEFAULT_PERSONA, languages: ["he", "en"] }).ok, true);
assert.equal(parsePersona({ ...DEFAULT_PERSONA, aiDisclosure: { enabled: true, text: "Je suis Tamara." } }).ok, false, "custom line must mention AI");
assert.equal(parsePersona({ ...DEFAULT_PERSONA, aiDisclosure: { enabled: true, text: "Je suis une IA." } }).ok, true);
assert.equal(parsePersona({ ...DEFAULT_PERSONA, mood: "happy" }).ok, false, "no personality/emotion fields (strict)");
{
  const m = mergePersona(DEFAULT_PERSONA, { greeting: { text: "Bonjour !" } });
  assert.ok(m.ok && m.value.greeting.mode === "auto" && m.value.greeting.text === "Bonjour !", "merge key by key, text kept in auto");
  const m2 = mergePersona(DEFAULT_PERSONA, { greeting: { mode: "custom", text: "Bonjour !" }, name: "Tamara" });
  assert.ok(m2.ok);
  // the auto/custom switch decides what the engine gets
  assert.equal(personaToInbound(m.ok ? m.value : DEFAULT_PERSONA, { businessName: "" }).greetingInstructions.includes("Bonjour !"), false);
  assert.match(personaToInbound(m2.ok ? m2.value : DEFAULT_PERSONA, { businessName: "" }).greetingInstructions, /^Bonjour !/);
}
assert.deepEqual(Object.keys(PERSONA_FIELD_LEVEL).sort(), [
  "aiDisclosure.enabled", "aiDisclosure.text", "greeting.mode", "greeting.text", "languages", "name", "primaryLanguage",
]);
assert.equal(PERSONA_FIELD_LEVEL.languages, 2);

console.log("ALL PERSONA-CONTRACT TESTS PASSED");
