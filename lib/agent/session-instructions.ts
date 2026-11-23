// The session instructions the agent receives — ONE pure function per side.
// /api/agent/config and the outbound config routes call these, and the
// dashboard prompt preview renders exactly the same text (no copy).
// Pure: the routes load the per-plan admin directives and pass them in.

import { DEFAULT_CAPABILITIES_DIRECTIVE } from "@/lib/agent-prompt-defaults";
import { renderCapabilitiesDirective } from "@/lib/capabilities";
import { buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { knowledgeFromInbound } from "@/lib/knowledge/adapters";
import { inboundInstructionsBlock, inboundKnowledgeBlock } from "@/lib/knowledge/render";
import { effectiveSpokenLanguages, inboundLanguageDirective, lockedLanguage, withOutboundLanguages } from "@/lib/persona/languages";
import { effectiveVoiceProfile } from "@/lib/voice-profile";
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
    /**
     * agent_configs.voice_profile: the column the served voiceProfile is
     * built from (servedInboundVoice → toEngineSettings), so the lock read
     * here is the one the worker receives.
     */
    voiceProfile: unknown;
  };
  planKey: string;
  directives: InboundDirectives;
  capabilities: { calendar: boolean; crm: boolean; orders: boolean };
}

/** The receptionist's instruction SECTIONS (block id → text), in the admin's order. */
export interface InboundSections {
  order: string[];
  blocks: Record<string, string>;
  capabilities: string;
}

export function inboundSessionSections(input: InboundInstructionsInput): InboundSections {
  const { config, planKey: k, directives: d } = input;
  // inheritAdminGlobals=false → the admin blocks are blanked: the prompt is
  // then persona + knowledge + language (+ capabilities).
  const inherits = config.inheritAdminGlobals !== false;
  const globalInstructions = inherits ? (d.globalByPlan[k] ?? "") : "";
  const primary = config.primaryLanguage ?? "fr";
  // Knowledge (brick S1): company facts + this agent's instructions.
  const knowledge = knowledgeFromInbound({
    business: config.business,
    instructions: config.instructions,
    knowledge: config.knowledge,
  });
  return {
    order: d.blockOrderByPlan[k] ?? [],
    blocks: {
      spoken_time: inherits ? (d.spokenTimeByPlan[k] ?? "") : "",
      spoken_phone: inherits ? (d.spokenPhoneByPlan[k] ?? "") : "",
      hangup: inherits ? (d.hangupByPlan[k] ?? "") : "",
      config_blocks: inherits ? (d.configBlocksByPlan[k] ?? "") : "",
      persona: inboundInstructionsBlock(knowledge.agent),
      knowledge: inboundKnowledgeBlock(knowledge),
      // Spoken languages (Persona P4): empty list = today's text.
      // Voice lock on (brick V): ONE rule, the locked language, the same one
      // the worker's "Always answer in X" line names. Lock off = unchanged.
      language: inboundLanguageDirective(
        primary,
        effectiveSpokenLanguages(config.personaConfig),
        lockedLanguage(effectiveVoiceProfile(config.voiceProfile), config.primaryLanguage),
      ),
      admin_global: globalInstructions
        ? `RÈGLES TRANSVERSES ADDITIONNELLES (à appliquer EN COMPLÉMENT du persona, jamais à sa place) :\n\n${globalInstructions}`
        : "",
    },
    capabilities: renderCapabilitiesDirective(d.capabilitiesByPlan[k] ?? DEFAULT_CAPABILITIES_DIRECTIVE, input.capabilities),
  };
}

/** The receptionist's instructions, exactly as /api/agent/config assembled them. */
export function inboundSessionInstructions(input: InboundInstructionsInput): string {
  const s = inboundSessionSections(input);
  return [...s.order.map((id) => s.blocks[id] ?? "").filter(Boolean), s.capabilities].join(BLOCK_SEPARATOR);
}

/**
 * The tenant's OWN part (developer-mode preview), from the same sections —
 * never a filtered copy of the full text, so no admin directive can leak.
 */
export function inboundTenantSections(input: InboundInstructionsInput): { companySheet: string; instructions: string } {
  const s = inboundSessionSections(input);
  return { companySheet: s.blocks.knowledge ?? "", instructions: s.blocks.persona ?? "" };
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
