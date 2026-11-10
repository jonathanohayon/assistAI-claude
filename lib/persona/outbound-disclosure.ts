// Outbound AI disclosure (Persona P5): the callee hears that the agent is an
// AI. Pure. Built on the web like everything the callee hears (greeting +
// instructions), so no worker change.
//
// SHIPPED OFF: outbound agents default to aiDisclosure.enabled=false (P1
// adapter), and only admins can turn it on until Jonathan's test call
// (OUTBOUND_DISCLOSURE_TENANT_EDITABLE, enforced on write in store.ts).
// Off = today's greeting and instructions, byte-identical (tested).

import { disclosureSentence, insertDisclosure, mentionsAi } from "@/lib/ai-disclosure";
import { parsePersona } from "@/lib/persona/contract";

export interface OutboundDisclosure {
  enabled: boolean;
  text: string;
}

/** The stored outbound disclosure (never written / invalid → off). */
export function effectiveOutboundDisclosure(personaConfig: unknown): OutboundDisclosure {
  const p = parsePersona(personaConfig);
  return p.ok ? p.value.aiDisclosure : { enabled: false, text: "" };
}

/**
 * The fixed first sentence, with the disclosure inserted (same placement
 * rules as the receptionist). Off, empty greeting, or a greeting that already
 * says it's an AI → unchanged.
 */
export function outboundGreetingWithDisclosure(
  greeting: string,
  d: OutboundDisclosure,
  ctx: { language: string; agentName: string },
): string {
  if (!d.enabled || !greeting.trim() || mentionsAi(greeting)) return greeting;
  return insertDisclosure(greeting, d.text.trim() || disclosureSentence(ctx.language, ctx.agentName));
}

/**
 * When the model opens by itself (no fixed sentence), it is told to say it in
 * its first sentence. Off or a fixed sentence → "" (nothing added).
 */
export function outboundDisclosureDirective(greeting: string, d: OutboundDisclosure): string {
  if (!d.enabled || greeting.trim()) return "";
  const line = d.text.trim();
  return line
    ? `ANNONCE IA : dans ta toute première phrase, dis exactement : « ${line} »`
    : "ANNONCE IA : dans ta toute première phrase, précise brièvement que tu es une intelligence artificielle (dans la langue de l'appel).";
}

/** Instructions + the directive (unchanged when there is none). */
export function withOutboundDisclosureDirective(instructions: string, greeting: string, d: OutboundDisclosure): string {
  const line = outboundDisclosureDirective(greeting, d);
  return line ? `${instructions}\n\n${line}` : instructions;
}
