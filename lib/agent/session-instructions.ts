// The session instructions the agent receives — ONE pure function per side.
// /api/agent/config and the outbound config routes call these, and the
// dashboard prompt preview renders exactly the same text (no copy).
// Pure: the routes load the per-plan admin directives and pass them in.

import { DEFAULT_CAPABILITIES_DIRECTIVE } from "@/lib/agent-prompt-defaults";
import { renderCapabilitiesDirective } from "@/lib/capabilities";
import { buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { knowledgeFromInbound } from "@/lib/knowledge/adapters";
import { inboundInstructionsBlock, inboundKnowledgeBlock } from "@/lib/knowledge/render";
import { effectiveSpokenLanguages, inboundLanguageDirective, withOutboundLanguages } from "@/lib/persona/languages";
import { withOutboundDisclosureDirective, type OutboundDisclosure } from "@/lib/persona/outbound-disclosure";

export const BLOCK_SEPARATOR = "\n\n──────────────────────────────────────────\n\n";

type ByPlan<T> = Partial<Record<string, T>>;

export interface InboundDirectives {
  globalByPlan: ByPlan<string>;
  spokenTimeByPlan: ByPlan<string>;
  spokenPhoneByPlan: ByPlan<string>;
  hangupByPlan: ByPlan<string>;
  configBlocksByPlan: ByPlan<string>;
  blockOrderByPlan: ByPlan<string[]>;
  capabilitiesByPlan: ByPlan<string>;
}

export interface InboundInstructionsInput {
  config: {
    inheritAdminGlobals: boolean | null;
    primaryLanguage: string | null;
    personaConfig: unknown;
    business: unknown;
    instructions: string | null;
    knowledge: unknown;
  };
  planKey: string;
  directives: InboundDirectives;
  capabilities: { calendar: boolean; crm: boolean; orders: boolean };
}

/** The receptionist's instructions, exactly as /api/agent/config assembled them. */
export function inboundSessionInstructions(input: InboundInstructionsInput): string {
  const { config, planKey: k, directives: d } = input;
  // inheritAdminGlobals=false → the admin blocks are blanked: the prompt is
  // then persona + knowledge + language (+ capabilities).
  const inherits = config.inheritAdminGlobals !== false;
  const spokenTime = inherits ? (d.spokenTimeByPlan[k] ?? "") : "";
  const spokenPhone = inherits ? (d.spokenPhoneByPlan[k] ?? "") : "";
  const hangup = inherits ? (d.hangupByPlan[k] ?? "") : "";
  const configBlocks = inherits ? (d.configBlocksByPlan[k] ?? "") : "";
  const blockOrder = d.blockOrderByPlan[k] ?? [];
  const globalInstructions = inherits ? (d.globalByPlan[k] ?? "") : "";

  const capabilitiesDirective = renderCapabilitiesDirective(
    d.capabilitiesByPlan[k] ?? DEFAULT_CAPABILITIES_DIRECTIVE,
    input.capabilities,
  );
  const primary = config.primaryLanguage ?? "fr";
  // Spoken languages (Persona P4): empty list = today's text.
  const languageDirective = inboundLanguageDirective(primary, effectiveSpokenLanguages(config.personaConfig));
  const adminBlock = globalInstructions
    ? `RÈGLES TRANSVERSES ADDITIONNELLES (à appliquer EN COMPLÉMENT du persona, jamais à sa place) :\n\n${globalInstructions}`
    : "";
  // Knowledge (brick S1): company facts + this agent's instructions.
  const knowledge = knowledgeFromInbound({
    business: config.business,
    instructions: config.instructions,
    knowledge: config.knowledge,
  });
  const blockContent: Record<string, string> = {
    spoken_time: spokenTime,
    spoken_phone: spokenPhone,
    hangup,
    config_blocks: configBlocks,
    persona: inboundInstructionsBlock(knowledge.agent),
    knowledge: inboundKnowledgeBlock(knowledge),
    language: languageDirective,
    admin_global: adminBlock,
  };
  return [...blockOrder.map((id) => blockContent[id] ?? "").filter(Boolean), capabilitiesDirective].join(
    BLOCK_SEPARATOR,
  );
}

export interface OutboundInstructionsInput {
  campaign: Parameters<typeof buildCampaignInstructions>[0];
  contact: Parameters<typeof buildCampaignInstructions>[1];
  framings: Parameters<typeof buildCampaignInstructions>[2];
  primaryLanguage: string;
  spokenLanguages: Parameters<typeof withOutboundLanguages>[2];
  /** The greeting before the disclosure (decides the disclosure directive). */
  baseGreeting: string;
  disclosure: OutboundDisclosure;
}

/** An outbound agent's instructions, exactly as the campaign / test routes assembled them. */
export function outboundSessionInstructions(input: OutboundInstructionsInput): string {
  const base = buildCampaignInstructions(input.campaign, input.contact, input.framings);
  // Spoken languages (Persona P4): empty list = today's text.
  const withLanguages = withOutboundLanguages(base, input.primaryLanguage, input.spokenLanguages);
  // Outbound AI disclosure (Persona P5): off = today's text.
  return withOutboundDisclosureDirective(withLanguages, input.baseGreeting, input.disclosure);
}
