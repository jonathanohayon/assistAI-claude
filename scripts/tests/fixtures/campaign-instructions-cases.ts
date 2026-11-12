// Inputs for the golden campaign instructions (M2a proof). Mock data only.
// The goldens (campaign-instructions-golden.json) were captured on
// origin/main with:
//   npx tsx scripts/tests/fixtures/campaign-instructions-cases.ts > scripts/tests/fixtures/campaign-instructions-golden.json
import { buildCampaignInstructions, DEFAULT_GOAL_FRAMINGS } from "../../../lib/campaigns/prompt";
import { outboundSessionInstructions } from "../../../lib/agent/session-instructions";
import { campaignGoalFields, missionFromCampaign, OUTBOUND_TEST_MISSION } from "../../../lib/mission/adapters";

// The presets of the M2a capture (37 goldens, unchanged since). The M2d
// presets have one golden each (NEW_PRESET_CASES), appended after them.
export const PRESETS = ["cold", "sales", "lead_gen", "marketing", "custom", "legacy_unknown"];
export const NEW_PRESETS = ["book_for_seller", "follow_up"];

const persona = {
  agentName: "  Léa ",
  voice: "sage",
  language: "fr",
  instructions: "  Consignes pour {{NAME}} à {{ville}}.  ",
  greeting: "",
  knowledge: " Offre {{offre}} : 120. ",
};
const contact = { contactName: "Dana", phoneNumber: "+972500000000", vars: { ville: "Mockville", offre: "Automne" } };
// Admin override for "sales" (trimmed), whitespace-only for "lead_gen" (→ default).
const framings = { ...DEFAULT_GOAL_FRAMINGS, sales: "  Framing vente ADMIN mock {{offre}}.  ", lead_gen: "   " };

/** name → the exact text, for every preset × (default framings | admin override) and the test / no-agent inputs. */
export function goldenCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const goalPreset of PRESETS) {
    const c = { goalPreset, objective: "  Appeler {{name}} ({{phone}}) à {{Ville}}.  ", successCriteria: " Un RDV pour {{offre}}. ", extractionSchema: [] };
    const g = campaignGoalFields(missionFromCampaign(c));
    const campaign = { goalPreset: g.goalPreset, objective: g.objective, persona: { ...persona, successCriteria: g.successCriteria } };
    out[`${goalPreset} default`] = buildCampaignInstructions(campaign, contact, DEFAULT_GOAL_FRAMINGS);
    out[`${goalPreset} override`] = buildCampaignInstructions(campaign, contact, framings);
    out[`${goalPreset} no framings`] = buildCampaignInstructions(campaign, contact);
    out[`${goalPreset} session he+en`] = outboundSessionInstructions({
      campaign, contact, framings, primaryLanguage: "he", spokenLanguages: ["en"], baseGreeting: "", disclosure: { enabled: false, text: "" },
    });
    out[`${goalPreset} session disclosure`] = outboundSessionInstructions({
      campaign, contact, framings, primaryLanguage: "fr", spokenLanguages: [], baseGreeting: "Bonjour {{name}}", disclosure: { enabled: true, text: "" },
    });
    // No-agent fallback (Sarah / marin / fr).
    out[`${goalPreset} no agent`] = buildCampaignInstructions(
      { goalPreset: g.goalPreset, objective: g.objective, persona: { agentName: "Sarah", voice: "marin", language: "fr", successCriteria: g.successCriteria } },
      contact,
      framings,
    );
  }
  // Outbound test / preview inputs: preset "sales", objective "", successCriteria "", contact {}.
  const t = campaignGoalFields(OUTBOUND_TEST_MISSION);
  out["outbound test"] = buildCampaignInstructions({ goalPreset: t.goalPreset, objective: t.objective, persona: { ...persona, successCriteria: t.successCriteria } }, {}, framings);
  // M2d: one golden per new preset — a campaign with objective, criteria and
  // vars, served with the default framings (no admin override).
  for (const goalPreset of NEW_PRESETS) {
    const c = { goalPreset, objective: "  Appeler {{name}} ({{phone}}) à {{ville}}.  ", successCriteria: " Un RDV pour {{offre}}. ", extractionSchema: [] };
    const g = campaignGoalFields(missionFromCampaign(c));
    const campaign = { goalPreset: g.goalPreset, objective: g.objective, persona: { ...persona, successCriteria: g.successCriteria } };
    out[`${goalPreset} default`] = buildCampaignInstructions(campaign, contact, DEFAULT_GOAL_FRAMINGS);
  }
  return out;
}

if (process.argv[1]?.endsWith("campaign-instructions-cases.ts")) {
  process.stdout.write(JSON.stringify(goldenCases(), null, 1) + "\n");
}
