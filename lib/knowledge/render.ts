// Knowledge → the text the agent receives. Pure. ONE function per side:
//   - inbound: the `knowledge` and `persona` blocks of /api/agent/config;
//   - outbound: the knowledge text and instructions buildCampaignInstructions
//     embeds (it keeps building the rest of the prompt).

import { renderBusinessPromptBlock } from "@/lib/business";
import { businessFromSheet, type InboundKnowledge, type LegacyKnowledgeEntry } from "@/lib/knowledge/adapters";
import type { AgentKnowledge, CompanySheet } from "@/lib/knowledge/contract";

function legacyBlock(entries: LegacyKnowledgeEntry[]): string {
  const kept = entries.filter((e) => (e?.businessName?.length ?? 0) > 0 || (e?.description?.length ?? 0) > 0);
  if (!kept.length) return "";
  return `BUSINESS — INFOS LEGACY (sera migré vers structure complète au prochain save dashboard) :\n\n${kept
    .map((e, i) => {
      const lines: string[] = [];
      lines.push(`### ${i + 1}. ${e.businessName || "(sans nom)"}`);
      if (e.openingHours) lines.push(`Horaires : ${e.openingHours}`);
      if (e.description) lines.push(`Détails : ${e.description}`);
      return lines.join("\n");
    })
    .join("\n\n")}`;
}

/** Receptionist: the prompt's `knowledge` block (company facts). */
export function inboundKnowledgeBlock(k: InboundKnowledge): string {
  if (k.legacy.structured) return renderBusinessPromptBlock(businessFromSheet(k.sheet));
  return legacyBlock(k.legacy.entries);
}

/** Receptionist: the prompt's `persona` block (this agent's instructions). */
export function inboundInstructionsBlock(agent: AgentKnowledge): string {
  return agent.instructions;
}

/** Outbound: what buildCampaignInstructions receives as knowledge + instructions. */
export function outboundKnowledgeParts(k: { sheet: CompanySheet; agent: AgentKnowledge }): {
  knowledge: string;
  instructions: string;
} {
  return { knowledge: k.sheet.notes, instructions: k.agent.instructions };
}
