// Today's data → Knowledge contract. Pure.
//   inbound  agent_configs: `business` JSON (identity, centres, services,
//            centresRules, knowledgeBase) + `instructions`; legacy
//            `knowledge` array (deprecated since May, removed in S6)
//   outbound outbound_agents: per-agent free text `knowledge` (+ its
//            `knowledgeSources`) + `instructions`

import { sanitizeBusinessConfig, type BusinessConfig } from "@/lib/business";
import {
  EMPTY_COMPANY_SHEET,
  KNOWLEDGE_CONTRACT_VERSION,
  type AgentKnowledge,
  type CompanySheet,
} from "@/lib/knowledge/contract";

export function sheetFromBusiness(b: BusinessConfig): CompanySheet {
  return {
    version: KNOWLEDGE_CONTRACT_VERSION,
    identity: { ...b.identity },
    locations: b.centres.map((c) => ({ id: c.id, name: c.name, address: c.address, hours: c.hours })),
    services: b.services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceILS: s.priceILS,
      locationIds: s.centreIds,
      description: s.description,
    })),
    locationRules: b.centresRules ?? "",
    notes: b.knowledgeBase ?? "",
    faq: [],
    sources: [],
  };
}

/** The inverse, lossless for everything the business JSON holds. */
export function businessFromSheet(s: CompanySheet): BusinessConfig {
  return {
    identity: { ...s.identity },
    centres: s.locations.map((l) => ({ id: l.id, name: l.name, address: l.address, hours: l.hours })),
    services: s.services.map((x) => ({
      id: x.id,
      name: x.name,
      durationMinutes: x.durationMinutes,
      priceILS: x.priceILS,
      centreIds: x.locationIds,
      description: x.description,
    })),
    centresRules: s.locationRules,
    knowledgeBase: s.notes,
  };
}

export interface LegacyKnowledgeEntry {
  businessName?: string;
  openingHours?: string;
  description?: string;
}

/**
 * Inbound today, with the route's two quirks kept OUTSIDE the contract (S6
 * deletes `legacy`): the structured block is chosen from the RAW business
 * JSON (a name, a centre or a service present), else the deprecated
 * `knowledge` array is rendered in its own format.
 */
export interface InboundKnowledge {
  sheet: CompanySheet;
  agent: AgentKnowledge;
  legacy: { structured: boolean; entries: LegacyKnowledgeEntry[] };
}

export function knowledgeFromInbound(row: {
  business: unknown;
  instructions: string | null;
  knowledge: unknown;
}): InboundKnowledge {
  const raw = row.business as Partial<BusinessConfig> | null | undefined;
  const structured = !!(
    raw &&
    typeof raw === "object" &&
    ((raw.identity?.name ?? "").length > 0 || (raw.centres?.length ?? 0) > 0 || (raw.services?.length ?? 0) > 0)
  );
  return {
    sheet: raw && typeof raw === "object" ? sheetFromBusiness(sanitizeBusinessConfig(raw)) : { ...EMPTY_COMPANY_SHEET },
    agent: { version: KNOWLEDGE_CONTRACT_VERSION, instructions: row.instructions ?? "" },
    legacy: {
      structured,
      entries: Array.isArray(row.knowledge) ? (row.knowledge as LegacyKnowledgeEntry[]) : [],
    },
  };
}

/** Outbound today: the agent's free text is its own facts (S5 moves agents to the account sheet). */
export function knowledgeFromOutbound(row: {
  knowledge: string | null;
  knowledgeSources?: unknown;
  instructions: string | null;
} | null): { sheet: CompanySheet; agent: AgentKnowledge } {
  const sources = Array.isArray(row?.knowledgeSources)
    ? (row!.knowledgeSources as unknown[]).filter((u): u is string => typeof u === "string").map((url) => ({ url, learnedAt: null }))
    : [];
  return {
    sheet: { ...EMPTY_COMPANY_SHEET, notes: row?.knowledge ?? "", sources },
    agent: { version: KNOWLEDGE_CONTRACT_VERSION, instructions: row?.instructions ?? "" },
  };
}
