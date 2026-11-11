// The /api/agent/outbound-test-config handler, MOVED VERBATIM from its route file (A3) so the
// legacy route and the single session-config route run the SAME code: the
// legacy response stays byte-identical. SERVER-ONLY.

import { outboundKnowledgeText } from "@/lib/knowledge/outbound-sheet";
import { accountSheetForOutbound } from "@/lib/knowledge/outbound-sheet-load";
import { knowledgeFromOutbound } from "@/lib/knowledge/adapters";
import { outboundKnowledgeParts } from "@/lib/knowledge/render";
import { effectiveOutboundDisclosure, outboundGreetingWithDisclosure } from "@/lib/persona/outbound-disclosure";
import { effectiveSpokenLanguages } from "@/lib/persona/languages";
import { outboundSessionInstructions } from "@/lib/agent/session-instructions";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { buildCampaignGreeting } from "@/lib/campaigns/prompt";
import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import { getCampaignGoalFramings } from "@/lib/settings";
import { personalityToRealtime, type AgentPersonality } from "@/lib/voice-tuning";
import { outboundModel, servedOutboundVoice } from "@/lib/voice/serve";
import { outboundCallFeatures } from "@/lib/tools/adapters";
import { capabilityInputsFor } from "@/lib/tools/load";
import { outboundCapabilities } from "@/lib/tools/store";
import { campaignGoalFields, OUTBOUND_TEST_MISSION } from "@/lib/mission/adapters";
import { toEngineSettings } from "@/lib/voice/engine";

// GET /api/agent/outbound-test-config?agentId=  (x-internal-secret)
// Config runtime servie au worker pour un TEST LIVE d'agent sortant depuis le
// dashboard. Même forme que /api/agent/campaign-config (le worker réutilise le
// même parser), mais bâtie depuis l'agent réutilisable seul — sans campagne ni
// contact : on teste sa voix / persona / connaissance « à blanc ».
export async function handleOutboundTestConfig(req: NextRequest): Promise<Response> {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const agentId = req.nextUrl.searchParams.get("agentId") ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const [agent] = await db
    .select()
    .from(outboundAgents)
    .where(eq(outboundAgents.id, agentId))
    .limit(1);
  if (!agent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  // Knowledge (brick S1): the agent's facts and instructions through the
  // Knowledge contract — identical text to before (route snapshots).
  const agentKnowledge = outboundKnowledgeParts(knowledgeFromOutbound(agent ?? null));
  // Knowledge S5: the account's company sheet, only when the server switch
  // OUTBOUND_COMPANY_SHEET is on for this account (off = null = today).
  const accountSheet = await accountSheetForOutbound(agent.userId);
  // Tools (T1): the same function as the receptionist and the screen.
  const toolInputs = await capabilityInputsFor(agent.userId);
  const { capabilities } = outboundCapabilities(agent.toolsConfig, toolInputs.account.googleConnected, toolInputs.plan);
  // Mission (M1): no campaign goal in a test → preset "sales", so the agent
  // still presents its offer (OUTBOUND_TEST_MISSION, as before).
  const goal = campaignGoalFields(OUTBOUND_TEST_MISSION);
  const persona = {
    agentName: agent.agentName,
    voice: agent.voice,
    language: agent.language,
    instructions: agentKnowledge.instructions,
    greeting: agent.greeting,
    knowledge: outboundKnowledgeText(agentKnowledge.knowledge, accountSheet),
    successCriteria: goal.successCriteria,
  };

  // Pas d'objectif de campagne en test → preset "sales" pour que l'agent
  // présente quand même son offre (sinon il resterait passif). Pas de contact.
  const framings = await getCampaignGoalFramings();
  const baseGreeting = buildCampaignGreeting({ persona }, {});
  // Outbound AI disclosure (Persona P5), OFF unless enabled on the agent
  // (admins only for now). Off = today's greeting and instructions.
  const disclosure = effectiveOutboundDisclosure(agent.personaConfig);
  const greetingInstructions = outboundGreetingWithDisclosure(baseGreeting, disclosure, {
    language: persona.language || "fr",
    agentName: (persona.agentName || "Sarah").trim(),
  });
  // The session instructions: ONE pure function (also used by the prompt
  // preview). No campaign in a test → "sales" preset, no contact.
  const instructions = outboundSessionInstructions({
    campaign: { goalPreset: goal.goalPreset, objective: goal.objective, persona },
    contact: {},
    framings,
    primaryLanguage: persona.language || "fr",
    spokenLanguages: effectiveSpokenLanguages(agent.personaConfig),
    baseGreeting,
    disclosure,
  });

  const tuning = personalityToRealtime(agent.personality, agent.noiseReductionLevel);

  // Voice contract (V2), served as `voiceConfig` (`voice` is the legacy voice
  // id the live worker reads). The legacy fields stay until worker V2 is live.
  const voiceConfig = servedOutboundVoice({
    voice: persona.voice || "marin",
    personality: agent.personality as AgentPersonality | null | undefined,
    noiseReductionLevel: agent.noiseReductionLevel ?? null,
  });

  const engine = toEngineSettings(voiceConfig, { defaultModel: outboundModel() });

  return NextResponse.json({
    voiceConfig,
    instructions,
    greetingInstructions,
    agentName: (persona.agentName || "Sarah").trim(),
    // Legacy engine fields, built through the contract (identical to before).
    model: engine.model,
    voice: engine.voice,
    temperature: tuning.temperature,
    speed: engine.speed,
    reactivite: tuning.reactivite,
    maxResponseTokens: 320,
    noiseReductionLevel: engine.noiseReductionLevel,
    primaryLanguage: persona.language || "fr",
    greetingFallbackTemplate: "",
    features: outboundCallFeatures(capabilities),
    updatedAt: new Date().toISOString(),
  });
}
