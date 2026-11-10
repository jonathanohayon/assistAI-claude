// `persona` → what the engine receives today: agentName, primaryLanguage and
// greetingInstructions (the sentence the worker speaks verbatim; '' = the
// model opens by itself). Pure.
//
// The heard sentence keeps ONE source per side:
//   - inbound: lib/ai-disclosure.ts effectiveGreeting (also used by the
//     pre-rendered opener and the dashboard preview);
//   - outbound: lib/campaigns/prompt.ts buildCampaignGreeting (variables).

import { effectiveGreeting } from "@/lib/ai-disclosure";
import { buildCampaignGreeting } from "@/lib/campaigns/prompt";
import type { Persona } from "@/lib/persona/contract";

export interface PersonaEngineSettings {
  agentName: string;
  primaryLanguage: string;
  greetingInstructions: string;
}

/** Inbound: the tenant's business name feeds the default disclosure sentence. */
export function personaToInbound(p: Persona, ctx: { businessName: string }): PersonaEngineSettings {
  return {
    agentName: p.name,
    primaryLanguage: p.primaryLanguage,
    greetingInstructions: effectiveGreeting(
      {
        greetingInstructions: p.greeting.mode === "custom" ? p.greeting.text : "",
        agentName: p.name,
        primaryLanguage: p.primaryLanguage,
        aiDisclosureEnabled: p.aiDisclosure.enabled,
        aiDisclosureText: p.aiDisclosure.text,
      },
      ctx.businessName,
    ),
  };
}

/** Outbound: the contact's variables are substituted in the first sentence. */
export function personaToOutbound(
  p: Persona,
  contact: { contactName?: string; phoneNumber?: string; vars?: Record<string, string> },
): PersonaEngineSettings {
  return {
    agentName: (p.name || "Sarah").trim(),
    primaryLanguage: p.primaryLanguage,
    greetingInstructions: buildCampaignGreeting(
      { persona: { greeting: p.greeting.mode === "custom" ? p.greeting.text : "" } },
      contact,
    ),
  };
}
