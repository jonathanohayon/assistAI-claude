// Golden instructions for SINGLE-LANGUAGE NON-FRENCH outbound agents (the
// one-line language instruction). Kept apart from the 37 M2a goldens on
// purpose: those are French or multi-language and stay byte-identical.
// Mock data only. Regenerate (only when the line itself changes) with:
//   npx tsx scripts/tests/fixtures/outbound-single-language-cases.ts > scripts/tests/fixtures/outbound-single-language-golden.json
import { DEFAULT_GOAL_FRAMINGS } from "../../../lib/campaigns/prompt";
import { outboundSessionInstructions } from "../../../lib/agent/session-instructions";
import { campaignGoalFields, missionFromCampaign, OUTBOUND_TEST_MISSION } from "../../../lib/mission/adapters";

const persona = (language: string) => ({
  agentName: "Mock Agent",
  voice: "marin",
  language,
  instructions: "Mock instructions for {{NAME}}.",
  greeting: "",
  knowledge: "Mock offer {{offre}}.",
});
const contact = { contactName: "Mock Contact", phoneNumber: "+15550000000", vars: { offre: "Mock" } };

/** name → the exact text: an EN-only and an HE-only campaign, an EN-only outbound test. */
export function singleLanguageCases(): Record<string, string> {
  const out: Record<string, string> = {};
  const g = campaignGoalFields(missionFromCampaign({ goalPreset: "appointment", objective: "Book a mock meeting with {{name}}.", successCriteria: "A meeting is booked.", extractionSchema: [] }));
  for (const lang of ["en", "he"]) {
    out[`campaign ${lang}-only`] = outboundSessionInstructions({
      campaign: { goalPreset: g.goalPreset, objective: g.objective, persona: { ...persona(lang), successCriteria: g.successCriteria } },
      contact,
      framings: DEFAULT_GOAL_FRAMINGS,
      primaryLanguage: lang,
      spokenLanguages: [],
      baseGreeting: "",
      disclosure: { enabled: false, text: "" },
    });
  }
  // Outbound test inputs: preset "sales", objective "", successCriteria "", contact {}.
  const t = campaignGoalFields(OUTBOUND_TEST_MISSION);
  out["outbound test en-only"] = outboundSessionInstructions({
    campaign: { goalPreset: t.goalPreset, objective: t.objective, persona: { ...persona("en"), successCriteria: t.successCriteria } },
    contact: {},
    framings: DEFAULT_GOAL_FRAMINGS,
    primaryLanguage: "en",
    spokenLanguages: [],
    baseGreeting: "",
    disclosure: { enabled: false, text: "" },
  });
  return out;
}

if (process.argv[1]?.endsWith("outbound-single-language-cases.ts")) {
  process.stdout.write(JSON.stringify(singleLanguageCases(), null, 1) + "\n");
}
