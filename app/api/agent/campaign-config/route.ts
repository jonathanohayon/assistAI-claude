import { effectiveOutboundDisclosure, outboundGreetingWithDisclosure, withOutboundDisclosureDirective } from "@/lib/persona/outbound-disclosure";
import { effectiveSpokenLanguages, withOutboundLanguages } from "@/lib/persona/languages";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { campaignContacts, campaigns, outboundAgents } from "@/lib/db/schema";
import { buildCampaignGreeting, buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { getCampaignGoalFramings } from "@/lib/settings";
import { personalityToRealtime, type AgentPersonality } from "@/lib/voice-tuning";
import { outboundModel, servedOutboundVoice } from "@/lib/voice/serve";
import { toEngineSettings } from "@/lib/voice/engine";

// GET /api/agent/campaign-config?campaignId=&contactId=  (x-internal-secret)
// Config runtime servie au worker pour un appel sortant donné. Même forme
// que /api/agent/config (le worker réutilise le même parser, tout en `?? default`).

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? "";
  const contactId = req.nextUrl.searchParams.get("contactId") ?? "";
  if (!campaignId || !contactId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }
  const [contact] = await db
    .select()
    .from(campaignContacts)
    .where(eq(campaignContacts.id, contactId))
    .limit(1);
  if (!contact) {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  }

  // Phase 2 : la persona vient de l'agent réutilisable associé (si présent).
  // Fallback sur la persona embarquée (campagnes pré-Phase 2 non encore
  // reliées à un agent). Le critère de succès est désormais niveau campagne.
  const agent = campaign.agentId
    ? ((
        await db
          .select()
          .from(outboundAgents)
          .where(eq(outboundAgents.id, campaign.agentId))
          .limit(1)
      )[0] ?? null)
    : null;
  const persona = agent
    ? {
        agentName: agent.agentName,
        voice: agent.voice,
        language: agent.language,
        instructions: agent.instructions,
        greeting: agent.greeting,
        knowledge: agent.knowledge,
        successCriteria: campaign.successCriteria,
      }
    : {
        // Campagne sans agent associé : défauts sûrs (la persona embarquée
        // n'existe plus depuis la Phase 3). Objectif + critère de succès
        // restent injectés dans le prompt via la campagne.
        agentName: "Sarah",
        voice: "marin",
        language: "fr",
        successCriteria: campaign.successCriteria,
      };
  // Framings de prompt éditables par l'admin (override des défauts par preset).
  const framings = await getCampaignGoalFramings();
  const baseInstructions = buildCampaignInstructions(
    { goalPreset: campaign.goalPreset, objective: campaign.objective, persona },
    { contactName: contact.contactName, phoneNumber: contact.phoneNumber, vars: contact.vars },
    framings,
  );
  // Spoken languages (Persona P4): empty list / switch off = today's text.
  const instructionsWithLanguages = withOutboundLanguages(
    baseInstructions,
    persona.language || "fr",
    effectiveSpokenLanguages(agent?.personaConfig),
  );
  const baseGreeting = buildCampaignGreeting({ persona }, {
    contactName: contact.contactName,
    phoneNumber: contact.phoneNumber,
    vars: contact.vars,
  });
  // Outbound AI disclosure (Persona P5), OFF unless enabled on the agent
  // (admins only for now). Off = today's greeting and instructions.
  const disclosure = effectiveOutboundDisclosure(agent?.personaConfig);
  const greetingInstructions = outboundGreetingWithDisclosure(baseGreeting, disclosure, {
    language: persona.language || "fr",
    agentName: (persona.agentName || "Sarah").trim(),
  });
  const instructions = withOutboundDisclosureDirective(instructionsWithLanguages, baseGreeting, disclosure);

  // Réglages voix dérivés de l'agent (mêmes sliders que l'agent entrant).
  const tuning = personalityToRealtime(
    agent?.personality,
    agent?.noiseReductionLevel,
  );

  // Voice contract (V2), served as `voiceConfig` (`voice` is the legacy voice
  // id the live worker reads). The legacy fields stay until worker V2 is live.
  const voiceConfig = servedOutboundVoice({
    voice: persona.voice || "marin",
    personality: agent?.personality as AgentPersonality | null | undefined,
    noiseReductionLevel: agent?.noiseReductionLevel ?? null,
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
    // Pas de calendrier/CRM/WhatsApp sur un appel sortant.
    features: {
      calendar: false,
      crm: false,
      whatsapp_confirm: false,
      whatsapp_recap: false,
      outbound_campaigns: true,
    },
    campaign: {
      id: campaign.id,
      contactId: contact.id,
      goalPreset: campaign.goalPreset,
    },
    updatedAt: new Date().toISOString(),
  });
}
