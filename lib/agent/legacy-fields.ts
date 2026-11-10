// Resolved agent → the fields today's routes serve that the bricks own. Pure.
// Used by A1's proof and by A3's single route (which keeps serving the old
// fields): ONE place that knows how the bricks become today's payload.

import type { ResolvedCall } from "@/lib/agent/contract";
import { outboundSessionInstructions } from "@/lib/agent/session-instructions";
import { inboundInstructionsBlock, inboundKnowledgeBlock } from "@/lib/knowledge/render";
import { outboundKnowledgeText } from "@/lib/knowledge/outbound-sheet";
import type { CompanySheet } from "@/lib/knowledge/contract";
import { personaToInbound, personaToOutbound } from "@/lib/persona/engine";
import { inboundLanguageDirective } from "@/lib/persona/languages";
import { outboundGreetingWithDisclosure } from "@/lib/persona/outbound-disclosure";
import { toEngineSettings } from "@/lib/voice/engine";

/** Voice + persona + account fields, the same for every origin. */
export function brickFields(r: ResolvedCall) {
  const { agent, account } = r;
  const engine = toEngineSettings(agent.voice, { defaultModel: agent.voice.advanced.model ?? "" });
  // Today's outbound routes don't serve realtimeProvider / voiceProfile (the
  // worker defaults them to openai / the default profile): same shape here.
  const { realtimeProvider, voiceProfile, ...outboundEngine } = engine;
  return {
    voiceConfig: agent.voice,
    ...(agent.recipe === "receptionist" ? { realtimeProvider, voiceProfile, ...outboundEngine } : outboundEngine),
    agentName: agent.recipe === "receptionist" ? agent.persona.name : (agent.persona.name || "Sarah").trim(),
    primaryLanguage: agent.persona.primaryLanguage,
    ...(agent.recipe === "receptionist"
      ? {
          greetingInstructions: personaToInbound(agent.persona, { businessName: account.businessName }).greetingInstructions,
          transferNumber: account.transferNumber,
          ownerWhatsapp: account.ownerWhatsapp,
        }
      : {}),
  };
}

/** Receptionist: the prompt blocks the bricks own (knowledge, persona, language). */
export function receptionistBlocks(r: ResolvedCall) {
  const { agent, account } = r;
  const sheetAsBusiness = { sheet: account.companySheet, agent: agent.knowledge, legacy: account.legacyKnowledge };
  return {
    knowledge: inboundKnowledgeBlock(sheetAsBusiness),
    persona: inboundInstructionsBlock(agent.knowledge),
    language: inboundLanguageDirective(agent.persona.primaryLanguage, agent.persona.languages),
  };
}

/**
 * Outbound: the full instructions and greeting today's campaign / test routes
 * build. `accountSheet` = the S5 sheet when its switch is on, else null.
 */
export function outboundPrompt(
  r: ResolvedCall,
  opts: { framings?: Partial<Record<string, string>>; accountSheet: CompanySheet | null },
) {
  const { agent, call } = r;
  const p = agent.persona;
  const isTest = call.origin.kind === "outbound_test";
  const contact = call.contact ? { contactName: call.contact.name, phoneNumber: call.contact.phone, vars: call.contact.vars } : {};
  const knowledge = outboundKnowledgeText(agent.legacyAgentFacts, opts.accountSheet);
  const persona = agent.id
    ? {
        agentName: p.name,
        language: p.primaryLanguage,
        instructions: agent.knowledge.instructions,
        greeting: p.greeting.mode === "custom" ? p.greeting.text : "",
        knowledge,
        successCriteria: isTest ? "" : (call.campaign?.successCriteria ?? ""),
      }
    : {
        agentName: "Sarah",
        language: "fr",
        successCriteria: call.campaign?.successCriteria ?? "",
        ...(opts.accountSheet ? { knowledge } : {}),
      };
  const baseGreeting = personaToOutbound(p, contact).greetingInstructions;
  return {
    // The same pure function as the outbound routes (lib/agent/session-instructions).
    instructions: outboundSessionInstructions({
      campaign: isTest
        ? { goalPreset: "sales", objective: "", persona }
        : { goalPreset: call.campaign?.goalPreset ?? "custom", objective: call.campaign?.objective ?? "", persona },
      contact,
      framings: opts.framings,
      primaryLanguage: p.primaryLanguage,
      spokenLanguages: p.languages,
      baseGreeting,
      disclosure: p.aiDisclosure,
    }),
    greetingInstructions: outboundGreetingWithDisclosure(baseGreeting, p.aiDisclosure, {
      language: p.primaryLanguage,
      agentName: (p.name || "Sarah").trim(),
    }),
  };
}
