import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignContacts, campaigns } from "@/lib/db/schema";
import {
  buildCampaignGreeting,
  buildCampaignInstructions,
} from "@/lib/campaigns/prompt";

export const dynamic = "force-dynamic";

// GET ?campaignId=&contactId= — réservé au worker (x-internal-secret).
// Renvoie la config runtime d'un appel de campagne (même forme que
// /api/agent/config : instructions/voice/model/…). Le worker la consomme via
// fetchConfig() quand l'origine de session est `campaign`.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? "";
  const contactId = req.nextUrl.searchParams.get("contactId") ?? "";
  if (!campaignId || !contactId)
    return NextResponse.json({ error: "missing_ids" }, { status: 400 });

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [contact] = await db
    .select()
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
      ),
    )
    .limit(1);
  if (!contact)
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 });

  const instructions = buildCampaignInstructions(campaign, contact);
  const greeting = buildCampaignGreeting(campaign, contact);
  const language = campaign.persona?.language ?? "fr";

  return NextResponse.json({
    // Forme alignée sur /api/agent/config pour réutiliser fetchConfig côté worker.
    instructions,
    greetingInstructions: greeting,
    agentName: campaign.persona?.agentName ?? "",
    model: "gpt-realtime-2",
    voice: campaign.persona?.voice || "marin",
    temperature: 0.8,
    speed: 1.0,
    maxResponseTokens: 320,
    noiseReductionLevel: 8,
    primaryLanguage: language,
    greetingFallbackTemplate: greeting,
    // Appels sortants : pas de tools booking/CRM par défaut.
    features: {
      calendar: false,
      crm: false,
      whatsapp_confirm: false,
      whatsapp_recap: false,
      outbound_campaigns: true,
    },
    // Contexte campagne (pratique pour debug worker).
    campaign: {
      id: campaign.id,
      contactId: contact.id,
      goalPreset: campaign.goalPreset,
    },
    updatedAt: campaign.updatedAt,
  });
}
