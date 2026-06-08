// Construit le system prompt + greeting d'un appel de campagne sortante à
// partir de la persona/objectif + des variables du contact ({{name}}, {{var}}).
// SERVER-ONLY (utilisé par /api/agent/campaign-config).

import type { Campaign, CampaignContact } from "@/lib/db/schema";

// Remplace {{name}}, {{phone}} et {{<varKey>}} par les valeurs du contact.
export function substituteVars(
  template: string,
  contact: Pick<CampaignContact, "contactName" | "phoneNumber" | "vars">,
): string {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (key === "name") return contact.contactName || "";
    if (key === "phone") return contact.phoneNumber || "";
    const v = contact.vars?.[key];
    return typeof v === "string" ? v : "";
  });
}

const GOAL_FRAMING: Record<string, string> = {
  cold: "Tu passes un appel à froid à un prospect qui ne te connaît pas. Sois courtois, accroche en une phrase, respecte son temps.",
  sales: "Tu rappelles un prospect déjà intéressé pour avancer vers la conclusion (démo, devis, signature).",
  lead_gen: "Ton but est de qualifier le prospect et de capturer son intérêt et ses besoins.",
  marketing: "Tu annonces une offre / nouveauté et tu mesures l'intérêt.",
  custom: "",
};

// Assemble les instructions de l'agent pour ce contact précis.
export function buildCampaignInstructions(
  campaign: Pick<Campaign, "goalPreset" | "objective" | "persona">,
  contact: Pick<CampaignContact, "contactName" | "phoneNumber" | "vars">,
): string {
  const p = campaign.persona ?? {};
  const parts: string[] = [];

  const framing = GOAL_FRAMING[campaign.goalPreset] ?? "";
  if (framing) parts.push(framing);

  if (p.agentName)
    parts.push(`Tu t'appelles ${p.agentName}. Présente-toi par ce prénom.`);

  if (campaign.objective)
    parts.push(`OBJECTIF DE L'APPEL :\n${substituteVars(campaign.objective, contact)}`);

  if (p.instructions)
    parts.push(substituteVars(p.instructions, contact));

  if (p.successCriteria)
    parts.push(
      `CRITÈRE DE SUCCÈS : ${substituteVars(p.successCriteria, contact)}`,
    );

  if (contact.contactName)
    parts.push(`Le prospect s'appelle ${contact.contactName}.`);

  parts.push(
    "Reste naturel et concis. Si le prospect n'est pas intéressé ou demande de ne plus être appelé, remercie-le et termine poliment. Ne raccroche jamais brutalement.",
  );

  return parts.filter(Boolean).join("\n\n");
}

export function buildCampaignGreeting(
  campaign: Pick<Campaign, "persona">,
  contact: Pick<CampaignContact, "contactName" | "phoneNumber" | "vars">,
): string {
  const g = campaign.persona?.greeting;
  if (g) return substituteVars(g, contact);
  // Greeting par défaut : salutation + présentation courte.
  const who = campaign.persona?.agentName ? `, c'est ${campaign.persona.agentName}` : "";
  return `Bonjour${who}. Vous avez un instant ?`;
}
