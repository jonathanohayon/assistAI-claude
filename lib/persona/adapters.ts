// Legacy columns → `persona`. Pure. The two sides name the same things
// differently today (unified on the inbound names in the contract):
//   inbound  agent_configs:   agent_name, primary_language, greeting_instructions, ai_disclosure_*
//   outbound outbound_agents: agent_name, language,         greeting              (no AI disclosure yet: P5)

import {
  DEFAULT_PERSONA,
  greetingModeOf,
  PERSONA_CONTRACT_VERSION,
  PERSONA_LANGUAGES,
  type Persona,
  type PersonaLanguage,
} from "@/lib/persona/contract";

const lang = (v: string | null | undefined): PersonaLanguage =>
  (PERSONA_LANGUAGES as readonly string[]).includes(v ?? "") ? (v as PersonaLanguage) : "fr";

export interface InboundPersonaColumns {
  agentName: string | null;
  primaryLanguage: string | null;
  greetingInstructions: string | null;
  aiDisclosureEnabled: boolean | null;
  aiDisclosureText: string | null;
}

export function personaFromInbound(row: InboundPersonaColumns): Persona {
  const text = row.greetingInstructions ?? "";
  return {
    version: PERSONA_CONTRACT_VERSION,
    name: row.agentName ?? "",
    primaryLanguage: lang(row.primaryLanguage),
    greeting: { mode: greetingModeOf(text), text },
    languages: [],
    aiDisclosure: {
      enabled: row.aiDisclosureEnabled !== false,
      text: row.aiDisclosureText ?? "",
    },
  };
}

export interface OutboundPersonaColumns {
  agentName: string | null;
  language: string | null;
  greeting: string | null;
}

/**
 * outbound_agents row → persona. `null` agent (a campaign with no agent) →
 * today's safe defaults ("Sarah", fr, no greeting). The AI disclosure ships
 * OFF for outbound until a test call validates it (P5).
 */
export function personaFromOutbound(row: OutboundPersonaColumns | null): Persona {
  const text = row?.greeting ?? "";
  return {
    ...DEFAULT_PERSONA,
    name: row ? (row.agentName ?? "") : "Sarah",
    primaryLanguage: lang(row?.language),
    greeting: { mode: greetingModeOf(text), text },
    aiDisclosure: { enabled: false, text: "" },
  };
}
