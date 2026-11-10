// Today's rows → the Agent contract. Pure. Built from what CALLS use today:
// the legacy columns (readers haven't switched), plus the stored spoken
// languages (P4) and outbound AI disclosure (P5) that the routes already read.

import type { AccountSettings, AgentDefinition } from "@/lib/agent/contract";
import { AGENT_CONTRACT_VERSION } from "@/lib/agent/contract";
import { knowledgeFromInbound, knowledgeFromOutbound } from "@/lib/knowledge/adapters";
import { currentCompanySheet } from "@/lib/knowledge/store";
import { personaFromInbound, personaFromOutbound } from "@/lib/persona/adapters";
import { effectiveSpokenLanguages } from "@/lib/persona/languages";
import { effectiveOutboundDisclosure } from "@/lib/persona/outbound-disclosure";
import { servedInboundVoice, servedOutboundVoice } from "@/lib/voice/serve";
import type { AgentPersonality } from "@/lib/voice-tuning";

type Cfg = {
  id: string;
  userId: string;
  voice: string | null;
  model: string | null;
  speed: number | null;
  realtimeProvider: string | null;
  voiceProfile: unknown;
  noiseReductionLevel: number | null;
  agentName: string | null;
  primaryLanguage: string | null;
  greetingInstructions: string | null;
  aiDisclosureEnabled: boolean | null;
  aiDisclosureText: string | null;
  personaConfig: unknown;
  instructions: string | null;
  business: unknown;
  knowledge: unknown;
  ownerWhatsapp: string | null;
  transferNumber: string | null;
  reminderEnabled: boolean | null;
  ownerDigestEnabled: boolean | null;
  forwardingVerifiedAt: Date | null;
};
type User = { id: string; displayName: string | null; subscriptionPlan: string | null; companySheet: unknown };

/** The receptionist of an account (agent_configs row). */
export function agentFromReceptionist(cfg: Cfg): AgentDefinition {
  const persona = personaFromInbound(cfg);
  return {
    version: AGENT_CONTRACT_VERSION,
    id: cfg.id,
    accountId: cfg.userId,
    recipe: "receptionist",
    internalName: "",
    voice: servedInboundVoice(cfg, cfg.model || "gpt-realtime-2"),
    persona: { ...persona, languages: effectiveSpokenLanguages(cfg.personaConfig) },
    knowledge: knowledgeFromInbound(cfg).agent,
    legacyAgentFacts: "",
  };
}

/** The account settings, from users + the account's agent_configs row. */
export function accountFrom(user: User, cfg: Cfg | null): AccountSettings {
  if (!cfg) {
    // An account without an agent_configs row (only reachable on outbound
    // paths, which never read it): empty settings.
    return {
      accountId: user.id,
      businessName: user.displayName ?? "",
      plan: user.subscriptionPlan ?? "",
      ownerWhatsapp: "",
      transferNumber: "",
      reminderEnabled: false,
      ownerDigestEnabled: true,
      forwardingVerifiedAt: null,
      companySheet: currentCompanySheet(user.companySheet, null),
      legacyKnowledge: { structured: false, entries: [] },
    };
  }
  const k = knowledgeFromInbound(cfg);
  return {
    accountId: user.id,
    businessName: user.displayName ?? "",
    plan: user.subscriptionPlan ?? "",
    ownerWhatsapp: cfg.ownerWhatsapp ?? "",
    transferNumber: cfg.transferNumber ?? "",
    reminderEnabled: cfg.reminderEnabled ?? false,
    ownerDigestEnabled: cfg.ownerDigestEnabled ?? true,
    forwardingVerifiedAt: cfg.forwardingVerifiedAt ? cfg.forwardingVerifiedAt.toISOString() : null,
    companySheet: currentCompanySheet(user.companySheet, cfg.business),
    legacyKnowledge: k.legacy,
  };
}

type Outbound = {
  id: string;
  userId: string;
  name: string;
  agentName: string | null;
  voice: string | null;
  language: string | null;
  greeting: string | null;
  instructions: string | null;
  knowledge: string | null;
  knowledgeSources: unknown;
  personality: unknown;
  noiseReductionLevel: number | null;
  personaConfig: unknown;
};

/**
 * An outbound agent, or `null` = a campaign with no agent: today's built-in
 * defaults (Sarah, marin, fr, no greeting, no knowledge).
 */
export function agentFromOutbound(row: Outbound | null, accountId: string): AgentDefinition {
  const persona = personaFromOutbound(row ? { agentName: row.agentName, language: row.language, greeting: row.greeting } : null);
  return {
    version: AGENT_CONTRACT_VERSION,
    id: row?.id ?? null,
    accountId: row?.userId ?? accountId,
    recipe: "outbound",
    internalName: row?.name ?? "",
    voice: servedOutboundVoice({
      voice: row?.voice || "marin",
      personality: (row?.personality ?? null) as AgentPersonality | null,
      noiseReductionLevel: row?.noiseReductionLevel ?? null,
    }),
    persona: {
      ...persona,
      languages: row ? effectiveSpokenLanguages(row.personaConfig) : [],
      aiDisclosure: row ? effectiveOutboundDisclosure(row.personaConfig) : persona.aiDisclosure,
    },
    knowledge: knowledgeFromOutbound(row).agent,
    legacyAgentFacts: knowledgeFromOutbound(row).sheet.notes,
  };
}
