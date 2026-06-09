import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignContacts, campaigns, outboundAgents } from "@/lib/db/schema";
import { buildCampaignGreeting, buildCampaignInstructions } from "@/lib/campaigns/prompt";
import { getCampaignGoalFramings } from "@/lib/settings";

// GET /api/agent/campaign-config?campaignId=&contactId=  (x-internal-secret)
// Config runtime servie au worker pour un appel sortant donné. Même forme
// que /api/agent/config (le worker réutilise le même parser, tout en `?? default`).

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
        ...(campaign.persona ?? {}),
        successCriteria:
          campaign.successCriteria || campaign.persona?.successCriteria || "",
      };
  // Framings de prompt éditables par l'admin (override des défauts par preset).
  const framings = await getCampaignGoalFramings();
  const instructions = buildCampaignInstructions(
    { goalPreset: campaign.goalPreset, objective: campaign.objective, persona },
    { contactName: contact.contactName, phoneNumber: contact.phoneNumber, vars: contact.vars },
    framings,
  );
  const greetingInstructions = buildCampaignGreeting({ persona }, {
    contactName: contact.contactName,
    phoneNumber: contact.phoneNumber,
    vars: contact.vars,
  });

  return NextResponse.json({
    instructions,
    greetingInstructions,
    agentName: (persona.agentName || "Sarah").trim(),
    model: process.env.REALTIME_MODEL || "gpt-realtime",
    voice: persona.voice || "marin",
    temperature: 0.8,
    speed: 1.0,
    maxResponseTokens: 320,
    noiseReductionLevel: 8,
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
