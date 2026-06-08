// Construction du system prompt d'un appel sortant à partir de la campagne
// (objectif + preset + persona) et du contact (nom + variables CSV). Les
// placeholders {{name}}, {{phone}} et {{var}} sont substitués ici.

import type { GoalPreset } from "@/lib/campaigns/constants";

interface CampaignPersona {
  agentName?: string;
  voice?: string;
  language?: string;
  instructions?: string;
  greeting?: string;
  successCriteria?: string;
}

const GOAL_FRAMING: Record<GoalPreset, string> = {
  cold: "Tu passes un appel à froid. Sois bref, chaleureux, et obtiens l'intérêt dans les 15 premières secondes.",
  sales: "Tu mènes un appel commercial. Qualifie le besoin, présente la valeur, et propose une prochaine étape concrète.",
  lead_gen: "Tu qualifies un prospect. Pose des questions ciblées pour évaluer l'intérêt et collecter les infos utiles.",
  marketing: "Tu fais un appel d'information marketing. Présente l'offre clairement et mesure l'intérêt.",
  custom: "",
};

function substituteVars(
  text: string,
  contact: { contactName?: string; phoneNumber?: string; vars?: Record<string, string> },
): string {
  let out = text
    .replace(/\{\{\s*name\s*\}\}/gi, contact.contactName || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, contact.phoneNumber || "");
  for (const [k, v] of Object.entries(contact.vars ?? {})) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi"), String(v ?? ""));
  }
  return out;
}

export function buildCampaignInstructions(
  campaign: { goalPreset: string; objective: string; persona: CampaignPersona },
  contact: { contactName?: string; phoneNumber?: string; vars?: Record<string, string> },
): string {
  const p = campaign.persona ?? {};
  const agentName = (p.agentName || "Sarah").trim();
  const framing = GOAL_FRAMING[campaign.goalPreset as GoalPreset] ?? "";

  const parts: string[] = [];
  parts.push(`Tu es ${agentName}, un agent vocal qui passe un appel sortant.`);
  if (framing) parts.push(framing);
  if (contact.contactName) parts.push(`Tu appelles ${contact.contactName}.`);
  if (campaign.objective?.trim())
    parts.push(`OBJECTIF DE L'APPEL :\n${campaign.objective.trim()}`);
  if (p.instructions?.trim())
    parts.push(`CONSIGNES :\n${p.instructions.trim()}`);
  if (p.successCriteria?.trim())
    parts.push(`CRITÈRE DE SUCCÈS :\n${p.successCriteria.trim()}`);
  parts.push(
    "Reste naturel·le et concis·e. Si la personne n'est pas intéressée, remercie et termine poliment. Ne raccroche pas avant d'avoir atteint l'objectif ou un refus clair.",
  );

  return substituteVars(parts.join("\n\n"), contact);
}

export function buildCampaignGreeting(
  campaign: { persona: CampaignPersona },
  contact: { contactName?: string; phoneNumber?: string; vars?: Record<string, string> },
): string {
  const greeting = campaign.persona?.greeting?.trim();
  if (greeting) return substituteVars(greeting, contact);
  return "Démarre l'appel par une salutation brève et chaleureuse, présente-toi par ton prénom, puis enchaîne sur l'objectif.";
}
