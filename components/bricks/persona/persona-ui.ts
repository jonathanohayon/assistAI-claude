// Persona brick — screen-side helpers over lib/persona/contract (P1). Pure,
// tenant-safe. The sentence callers hear comes from the ONE existing source
// per side, never re-implemented here:
//   inbound  → lib/ai-disclosure effectiveGreeting
//   outbound → lib/campaigns/prompt buildCampaignGreeting
//
// Until P3 stores `persona`, saves go through today's legacy fields, so the
// behaviour is exactly today's. Write mapping below = inverse of
// lib/persona/adapters (round trip pinned by scripts/tests/persona-brick.test.ts).

import { effectiveGreeting } from "@/lib/ai-disclosure";
import { buildCampaignGreeting } from "@/lib/campaigns/prompt";
import type { Persona } from "@/lib/persona/contract";

export type PersonaKind = "inbound" | "outbound";

export interface InboundPersonaFields {
  agentName: string;
  primaryLanguage: string;
  greetingInstructions: string;
  aiDisclosureEnabled: boolean;
  aiDisclosureText: string;
}

export interface OutboundPersonaFields {
  agentName: string;
  language: string;
  greeting: string;
}

const spokenGreeting = (p: Persona) => (p.greeting.mode === "custom" ? p.greeting.text : "");

export function toInboundFields(p: Persona): InboundPersonaFields {
  return {
    agentName: p.name,
    primaryLanguage: p.primaryLanguage,
    greetingInstructions: spokenGreeting(p),
    aiDisclosureEnabled: p.aiDisclosure.enabled,
    aiDisclosureText: p.aiDisclosure.text,
  };
}

export function toOutboundFields(p: Persona): OutboundPersonaFields {
  return { agentName: p.name, language: p.primaryLanguage, greeting: spokenGreeting(p) };
}

/**
 * What callers hear first, from the side's single source. null = no fixed
 * sentence: the agent opens by itself, from context.
 */
export function heardGreeting(
  p: Persona,
  kind: PersonaKind,
  ctx: { businessName?: string; exampleContact?: { contactName?: string; phoneNumber?: string } } = {},
): string | null {
  const text =
    kind === "inbound"
      ? effectiveGreeting(
          {
            greetingInstructions: spokenGreeting(p),
            agentName: p.name,
            primaryLanguage: p.primaryLanguage,
            aiDisclosureEnabled: p.aiDisclosure.enabled,
            aiDisclosureText: p.aiDisclosure.text,
          },
          ctx.businessName ?? "",
        )
      : buildCampaignGreeting({ persona: { greeting: spokenGreeting(p) } }, ctx.exampleContact ?? {});
  return text.trim() ? text : null;
}

/** Insert a variable at the end of the sentence, with a space if needed. */
export function insertVariable(text: string, variable: string): string {
  if (!text) return variable;
  return /\s$/.test(text) ? `${text}${variable}` : `${text} ${variable}`;
}
