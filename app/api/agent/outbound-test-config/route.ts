import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { buildCampaignGreeting, buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import { getCampaignGoalFramings } from "@/lib/settings";
import { personalityToRealtime } from "@/lib/voice-tuning";

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
  const instructions = buildCampaignInstructions(
    { goalPreset: "sales", objective: "", persona },
    {},
    framings,
  );
  const greetingInstructions = buildCampaignGreeting({ persona }, {});

  const tuning = personalityToRealtime(agent.personality, agent.noiseReductionLevel);

  return NextResponse.json({
    instructions,
    greetingInstructions,
    agentName: (persona.agentName || "Sarah").trim(),
    model: process.env.REALTIME_MODEL || "gpt-realtime",
    voice: persona.voice || "marin",
    temperature: tuning.temperature,
    speed: tuning.speed,
    reactivite: tuning.reactivite,
    maxResponseTokens: 320,
    noiseReductionLevel: tuning.noiseReductionLevel,
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
