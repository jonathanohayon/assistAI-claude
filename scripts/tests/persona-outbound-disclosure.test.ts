// Outbound AI disclosure (Persona P5). OFF = today's greeting and
// instructions, byte-identical; on = the callee hears it's an AI.
// Mock data only. Run with:  npx tsx scripts/tests/persona-outbound-disclosure.test.ts

import assert from "node:assert/strict";

import { buildCampaignGreeting } from "../../lib/campaigns/prompt";
import { personaFromOutbound } from "../../lib/persona/adapters";
import { DEFAULT_PERSONA, OUTBOUND_DISCLOSURE_TENANT_EDITABLE } from "../../lib/persona/contract";
import {
  effectiveOutboundDisclosure,
  outboundDisclosureDirective,
  outboundGreetingWithDisclosure,
  withOutboundDisclosureDirective,
} from "../../lib/persona/outbound-disclosure";
import { inboundPersonaUpdates, outboundPersonaUpdates } from "../../lib/persona/store";

const ctx = { language: "fr", agentName: "Dana" };
const off = { enabled: false, text: "" };
const on = { enabled: true, text: "" };

// shipped OFF: every way an outbound agent can be read today → disabled
assert.deepEqual(effectiveOutboundDisclosure(null), off, "never written");
assert.deepEqual(effectiveOutboundDisclosure({ broken: true }), off, "invalid");
assert.equal(personaFromOutbound({ agentName: "Dana", language: "fr", greeting: "" }).aiDisclosure.enabled, false);
assert.equal(personaFromOutbound(null).aiDisclosure.enabled, false);

// OFF = today, byte-identical (greeting + instructions)
const contact = { contactName: "Mock Contact" };
for (const g of ["", "   ", "Bonjour {{name}}, ici Dana de Mock !"]) {
  const today = buildCampaignGreeting({ persona: { greeting: g } }, contact);
  assert.equal(outboundGreetingWithDisclosure(today, off, ctx), today);
  assert.equal(withOutboundDisclosureDirective("Mock instructions", today, off), "Mock instructions");
}

// ON with a fixed sentence: inserted like the receptionist's, no directive
{
  const g = outboundGreetingWithDisclosure("Bonjour Mock Contact, ici Dana de Mock ! Vous avez une minute ?", on, ctx);
  assert.equal(g, "Bonjour Mock Contact, ici Dana de Mock ! Je suis Dana, une intelligence artificielle. Vous avez une minute ?");
  assert.equal(outboundDisclosureDirective("Bonjour !", on), "");
  // custom line; Hebrew
  assert.match(outboundGreetingWithDisclosure("Bonjour !", { enabled: true, text: "Je suis une IA." }, ctx), /Je suis une IA\./);
  assert.match(outboundGreetingWithDisclosure("שלום!", on, { language: "he", agentName: "דנה" }), /בינה מלאכותית/);
  // already says it → unchanged (no double)
  assert.equal(outboundGreetingWithDisclosure("Bonjour, ici Dana, l'assistante IA de Mock.", on, ctx), "Bonjour, ici Dana, l'assistante IA de Mock.");
}
// ON with the model opening: the greeting stays '' and the model is told
{
  assert.equal(outboundGreetingWithDisclosure("", on, ctx), "");
  assert.match(withOutboundDisclosureDirective("Mock instructions", "", on), /^Mock instructions\n\nANNONCE IA : dans ta toute première phrase, précise brièvement que tu es une intelligence artificielle/);
  assert.match(outboundDisclosureDirective("", { enabled: true, text: "Je suis une IA." }), /dis exactement : « Je suis une IA\. »/);
}

// write gate: tenants can't turn it on; admins can; unrelated tenant saves pass
{
  assert.equal(OUTBOUND_DISCLOSURE_TENANT_EDITABLE, false);
  const row = { agentName: "Dana", language: "fr", greeting: "", personaConfig: null as unknown };
  const turnOn = { personaConfig: { aiDisclosure: { enabled: true } } };
  const t = outboundPersonaUpdates(turnOn, row, false);
  assert.ok(t && "error" in t);
  assert.deepEqual(t.error, { status: 403, body: { error: "admin_only", fields: ["aiDisclosure.enabled"] } });
  const a = outboundPersonaUpdates(turnOn, row, true);
  assert.ok(a && !("error" in a) && a.persona.aiDisclosure.enabled);
  // admin turned it on; the tenant then renames the agent → allowed
  const afterAdmin = { ...row, personaConfig: a.persona };
  assert.ok(!("error" in (outboundPersonaUpdates({ personaConfig: { name: "Noa" } }, afterAdmin, false) ?? {})));
  // …but changing the line is still admin-only
  const line = outboundPersonaUpdates({ personaConfig: { aiDisclosure: { text: "Je suis une IA." } } }, afterAdmin, false);
  assert.ok(line && "error" in line && line.error.status === 403);
  // turning it OFF is always allowed
  assert.ok(!("error" in (outboundPersonaUpdates({ personaConfig: { aiDisclosure: { enabled: false } } }, afterAdmin, false) ?? {})));
}
// P4 gate fix: a tenant saving other fields under an ADMIN-set language list is fine
{
  const inRow = { agentName: "", primaryLanguage: "fr", greetingInstructions: "", aiDisclosureEnabled: true, aiDisclosureText: "", personaConfig: { ...DEFAULT_PERSONA, languages: ["he"] } };
  assert.ok(!("error" in (inboundPersonaUpdates({ personaConfig: { name: "Tamara" } }, inRow, false) ?? {})));
  const change = inboundPersonaUpdates({ personaConfig: { languages: ["he", "en"] } }, inRow, false);
  assert.ok(change && "error" in change && change.error.status === 403, "changing the list stays admin-only");
}

console.log("ALL PERSONA-OUTBOUND-DISCLOSURE TESTS PASSED");
