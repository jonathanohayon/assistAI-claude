// Loads the inputs of the session-instructions builders from the DB, with
// the SAME getters as the call routes — SERVER-ONLY. Used by the prompt
// preview, so it shows exactly what the call gets (proven by the PR's
// route-vs-preview snapshot).

import { eq } from "drizzle-orm";

import { effectiveGreeting } from "@/lib/ai-disclosure";
import type { InboundInstructionsInput, OutboundInstructionsInput } from "@/lib/agent/session-instructions";
import { buildCampaignGreeting, substituteVars } from "@/lib/campaigns/prompt";
import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import { knowledgeFromOutbound } from "@/lib/knowledge/adapters";
import { outboundKnowledgeText } from "@/lib/knowledge/outbound-sheet";
import { accountSheetForOutbound } from "@/lib/knowledge/outbound-sheet-load";
import { outboundKnowledgeParts } from "@/lib/knowledge/render";
import { effectiveSpokenLanguages } from "@/lib/persona/languages";
import { effectiveOutboundDisclosure, outboundGreetingWithDisclosure } from "@/lib/persona/outbound-disclosure";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS, type PlanKey } from "@/lib/plans";
import {
  getCampaignGoalFramings,
  getCapabilitiesDirectiveByPlan,
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getHangupDirectiveByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";
import type { ResolvedTenant } from "@/lib/tenant";
import { getTileToggles } from "@/lib/tile-toggles";

/** Inbound: same plan key, directives, features and capabilities as /api/agent/config. */
export async function loadInboundInstructionsInput(
  tenant: ResolvedTenant,
): Promise<{ input: InboundInstructionsInput; greeting: string }> {
  const [globalByPlan, planMatrix, spokenTimeByPlan, spokenPhoneByPlan, hangupByPlan, configBlocksByPlan, blockOrderByPlan, capabilitiesByPlan, tileToggles] =
    await Promise.all([
      getGlobalInstructionsByPlan(),
      getPlanFeatureMatrix(),
      getSpokenTimeDirectiveByPlan(),
      getSpokenPhoneDirectiveByPlan(),
      getHangupDirectiveByPlan(),
      getConfigBlocksDirectiveByPlan(),
      getPromptBlockOrderByPlan(),
      getCapabilitiesDirectiveByPlan(),
      getTileToggles(tenant.user.id),
    ]);
  const planKey: PlanKey =
    tenant.user.subscriptionPlan && PLANS.some((p) => p.key === tenant.user.subscriptionPlan)
      ? (tenant.user.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const planFeatures = featuresForPlan(planMatrix, tenant.user.subscriptionPlan);
  return {
    input: {
      config: tenant.config,
      planKey,
      directives: { globalByPlan, spokenTimeByPlan, spokenPhoneByPlan, hangupByPlan, configBlocksByPlan, blockOrderByPlan, capabilitiesByPlan },
      capabilities: {
        calendar: planFeatures.calendar && tileToggles.calendar,
        crm: planFeatures.crm && tileToggles.customers,
        orders: Boolean(planFeatures.crm) && tileToggles.orders,
      },
    },
    greeting: effectiveGreeting(tenant.config, tenant.user.displayName ?? ""),
  };
}

/**
 * Outbound agent: what its TEST call gets (/api/agent/outbound-test-config:
 * "sales" preset, no contact). null if the agent isn't the account's.
 */
export async function loadOutboundTestInstructionsInput(
  agentId: string,
  accountId: string,
): Promise<{ input: OutboundInstructionsInput; greeting: string; knowledge: string; agentInstructions: string } | null> {
  const [agent] = await db.select().from(outboundAgents).where(eq(outboundAgents.id, agentId)).limit(1);
  if (!agent || agent.userId !== accountId) return null;
  const agentKnowledge = outboundKnowledgeParts(knowledgeFromOutbound(agent));
  const accountSheet = await accountSheetForOutbound(agent.userId);
  const knowledge = outboundKnowledgeText(agentKnowledge.knowledge, accountSheet);
  const persona = {
    agentName: agent.agentName,
    voice: agent.voice,
    language: agent.language,
    instructions: agentKnowledge.instructions,
    greeting: agent.greeting,
    knowledge,
    successCriteria: "",
  };
  const baseGreeting = buildCampaignGreeting({ persona }, {});
  const disclosure = effectiveOutboundDisclosure(agent.personaConfig);
  return {
    input: {
      campaign: { goalPreset: "sales", objective: "", persona },
      contact: {},
      framings: await getCampaignGoalFramings(),
      primaryLanguage: persona.language || "fr",
      spokenLanguages: effectiveSpokenLanguages(agent.personaConfig),
      baseGreeting,
      disclosure,
    },
    greeting: outboundGreetingWithDisclosure(baseGreeting, disclosure, {
      language: persona.language || "fr",
      agentName: (persona.agentName || "Sarah").trim(),
    }),
    // As the agent receives them inside the instructions: trimmed, then the
    // test call's (empty) contact variables substituted.
    knowledge: substituteVars(knowledge.trim(), {}),
    agentInstructions: substituteVars(agentKnowledge.instructions.trim(), {}),
  };
}
