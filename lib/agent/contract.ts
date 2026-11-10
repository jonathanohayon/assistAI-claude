// The Agent contract (A1): ONE definition of an agent, composed of the bricks,
// plus the ACCOUNT settings a call needs and what is specific to the call.
// Types only + pure helpers. Nothing reads it yet (A3 builds the single route
// on it); no new table (A2).
//
// agent_configs mixes agent and account settings today: the contract
// separates them. A phone number resolves to an ACCOUNT, whose receptionist
// answers (one per account today).

import type { InboundKnowledge } from "@/lib/knowledge/adapters";
import type { AgentKnowledge, CompanySheet } from "@/lib/knowledge/contract";
import type { Persona } from "@/lib/persona/contract";
import type { Voice } from "@/lib/voice/contract";

export const AGENT_CONTRACT_VERSION = 1 as const;

/** What the agent is for (the Mission brick will refine it). */
export type AgentRecipe = "receptionist" | "outbound";

export interface AgentDefinition {
  version: typeof AGENT_CONTRACT_VERSION;
  /** agent_configs.id or outbound_agents.id; null = a campaign's built-in default agent. */
  id: string | null;
  accountId: string;
  recipe: AgentRecipe;
  /** Internal label (outbound list/campaigns); '' for the receptionist. */
  internalName: string;
  voice: Voice;
  persona: Persona;
  knowledge: AgentKnowledge;
  /**
   * An outbound agent's own learned text (its facts today). Moves to the
   * account sheet with S5; '' for the receptionist.
   */
  legacyAgentFacts: string;
}

/** Settings of the BUSINESS, not of an agent. */
export interface AccountSettings {
  accountId: string;
  /** users.displayName: the business name (default AI-disclosure sentence). */
  businessName: string;
  plan: string;
  ownerWhatsapp: string;
  transferNumber: string;
  reminderEnabled: boolean;
  ownerDigestEnabled: boolean;
  forwardingVerifiedAt: string | null;
  companySheet: CompanySheet;
  /**
   * Today's inbound knowledge quirks (raw-business condition + deprecated
   * `knowledge` array), kept OUTSIDE the sheet so the receptionist's prompt
   * stays identical — removed with S6.
   */
  legacyKnowledge: InboundKnowledge["legacy"];
}

export type CallOrigin =
  | { kind: "phone"; calledNumber: string }
  | { kind: "web"; userId: string }
  | { kind: "call_me"; userId: string }
  | { kind: "campaign"; campaignId: string; contactId: string }
  | { kind: "outbound_test"; agentId: string }
  /** tamaravox: its config lives in another service (resolved by the worker). */
  | { kind: "vox"; calledNumber: string };

export interface CallContext {
  origin: CallOrigin;
  contact: { id: string; name: string; phone: string; vars: Record<string, string> } | null;
  campaign: { id: string; goalPreset: string; objective: string; successCriteria: string } | null;
}

export interface ResolvedCall {
  agent: AgentDefinition;
  account: AccountSettings;
  call: CallContext;
}

export type Resolution =
  | { ok: true; resolved: ResolvedCall }
  /** Same refusals as today's routes (status + error code). */
  | { ok: false; status: 400 | 404; error: string }
  /** Not ours to resolve (tamaravox). */
  | { ok: false; external: true };
