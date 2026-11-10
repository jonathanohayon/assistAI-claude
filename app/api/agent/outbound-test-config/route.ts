import { effectiveSpokenLanguages, withOutboundLanguages } from "@/lib/persona/languages";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { buildCampaignGreeting, buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import { getCampaignGoalFramings } from "@/lib/settings";
import { personalityToRealtime, type AgentPersonality } from "@/lib/voice-tuning";
import { outboundModel, servedOutboundVoice } from "@/lib/voice/serve";
import { toEngineSettings } from "@/lib/voice/engine";

// GET /api/agent/outbound-test-config?agentId=  (x-internal-secret)
// Config runtime servie au worker pour un TEST LIVE d'agent sortant depuis le
// dashboard. Même forme que /api/agent/campaign-config (le worker réutilise le
// même parser), mais bâtie depuis l'agent réutilisable seul — sans campagne ni
// contact : on teste sa voix / persona / connaissance « à blanc ».
export async function GET(req: NextRequest) {
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

  const persona = {
    agentName: agent.agentName,
    voice: agent.voice,
    language: agent.language,
    instructions: agent.instructions,
    greeting: agent.greeting,
    knowledge: agent.knowledge,
    successCriteria: "",
  };

  // Pas d'objectif de campagne en test → preset "sales" pour que l'agent
  // présente quand même son offre (sinon il resterait passif). Pas de contact.
  const framings = await getCampaignGoalFramings();
  const baseInstructions = buildCampaignInstructions(
    { goalPreset: "sales", objective: "", persona },
    {},
    framings,
  );
  // Spoken languages (Persona P4): empty list / switch off = today's text.
  const instructions = withOutboundLanguages(
    baseInstructions,
    persona.language || "fr",
    effectiveSpokenLanguages(agent.personaConfig),
  );
  const greetingInstructions = buildCampaignGreeting({ persona }, {});

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
    features: {
      calendar: false,
      crm: false,
      whatsapp_confirm: false,
      whatsapp_recap: false,
      outbound_campaigns: true,
    },
    updatedAt: new Date().toISOString(),
  });
}
