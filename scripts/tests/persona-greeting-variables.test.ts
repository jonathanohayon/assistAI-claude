// Every first-sentence variable the Persona contract offers is substituted by
// the engine on its side — none is ever spoken literally. Mock data only.
// Run with:  npx tsx scripts/tests/persona-greeting-variables.test.ts

import assert from "node:assert/strict";

import { effectiveGreeting } from "../../lib/ai-disclosure";
import { buildCampaignGreeting } from "../../lib/campaigns/prompt";
import { GREETING_VARIABLES } from "../../lib/persona/contract";

const contact = { contactName: "Mock Contact", phoneNumber: "+97250000000", vars: { city: "Mockville" } };

// outbound: each offered variable is replaced (and nothing brace-like remains)
assert.ok(GREETING_VARIABLES.outbound.length > 0);
for (const v of GREETING_VARIABLES.outbound) {
  const out = buildCampaignGreeting({ persona: { greeting: `Bonjour ${v} !` } }, contact);
  assert.doesNotMatch(out, /\{|\}/, `${v} must be substituted, got: ${out}`);
  assert.notEqual(out, `Bonjour ${v} !`);
}
assert.equal(buildCampaignGreeting({ persona: { greeting: "Bonjour {{name}}, {{phone}}" } }, contact), "Bonjour Mock Contact, +97250000000");
// the old single-brace names were NOT substituted (the bug this guards)
assert.equal(buildCampaignGreeting({ persona: { greeting: "Bonjour {contactName}" } }, contact), "Bonjour {contactName}");

// inbound: nothing substitutes the tenant's sentence → no variable offered
assert.deepEqual([...GREETING_VARIABLES.inbound], []);
assert.match(
  effectiveGreeting(
    { greetingInstructions: "Bonjour {{name}}", agentName: "", primaryLanguage: "fr", aiDisclosureEnabled: false, aiDisclosureText: "" },
    "",
  ),
  /\{\{name\}\}/,
  "inbound would speak it literally — which is why none is offered",
);

console.log("ALL PERSONA-GREETING-VARIABLES TESTS PASSED");
