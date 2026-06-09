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
  /** Fiche métier distillée depuis un/des site(s) web. */
  knowledge?: string;
  knowledgeSources?: string[];
}

// Framings par preset — DÉFAUTS. Éditables depuis /admin (stockés dans
// app_settings.campaign_goal_framings, cf. lib/settings.ts). Exportés pour
// que l'admin affiche/réinitialise sur ces valeurs.
export const DEFAULT_GOAL_FRAMINGS: Record<GoalPreset, string> = {
  cold: "Tu passes un appel à FROID — c'est TOI qui appelles. Présente-toi et accroche dès les 15 premières secondes sur un bénéfice concret. N'attends pas qu'on te sollicite.",
  sales: "Tu es un VENDEUR en appel sortant. Dès l'accueil, présente-toi puis PRÉSENTE activement le produit / l'offre et son bénéfice principal (cite un prix ou un argument fort si pertinent). Tu MÈNES la conversation vers la vente ou la prochaine étape concrète, en t'appuyant sur ta base de connaissance. Tu ne demandes JAMAIS ce que la personne veut — c'est toi qui proposes.",
  lead_gen: "Tu mènes un appel SORTANT pour qualifier le prospect. Annonce d'abord brièvement la raison de ton appel et l'offre, puis pose des questions ciblées. N'attends pas qu'on te sollicite.",
  marketing: "Tu passes un appel SORTANT d'information. Présente clairement l'offre / la nouveauté dès le début, puis mesure l'intérêt.",
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
  // Framings éditables par l'admin (override des défauts). Si absent ou vide
  // pour le preset → fallback sur DEFAULT_GOAL_FRAMINGS.
  framings?: Partial<Record<string, string>>,
): string {
  const p = campaign.persona ?? {};
  const agentName = (p.agentName || "Sarah").trim();
  const framing =
    (framings?.[campaign.goalPreset]?.trim() ||
      DEFAULT_GOAL_FRAMINGS[campaign.goalPreset as GoalPreset]) ??
    "";

  const parts: string[] = [];
  parts.push(
    `Tu t'appelles ${agentName}. C'est TON prénom : présente-toi TOUJOURS et UNIQUEMENT sous « ${agentName} », jamais sous le nom de l'entreprise, de la marque, d'un produit ou d'une personne mentionnés dans ta base de connaissance. Tu es un agent vocal qui passe un appel SORTANT au nom de l'entreprise.`,
  );
  // Règle d'or : c'est l'agent qui appelle → il mène, il ne joue pas la
  // réceptionniste. Empêche le classique "que puis-je faire pour vous".
  parts.push(
    "RÈGLE CLÉ : c'est TOI qui appelles cette personne, ce n'est pas elle qui te contacte. Tu mènes la conversation : tu annonces toi-même la raison de l'appel et tu présentes l'offre. Ne dis JAMAIS « que puis-je faire pour vous », « comment puis-je vous aider » ni aucune formule d'accueil entrant.",
  );
  if (framing) parts.push(framing);
  if (contact.contactName) parts.push(`Tu appelles ${contact.contactName}.`);
  if (campaign.objective?.trim())
    parts.push(`OBJECTIF DE L'APPEL :\n${campaign.objective.trim()}`);
  // Connaissance métier apprise depuis le(s) site(s) web → l'agent devient
  // un vendeur spécialisé qui maîtrise l'offre, les prix et les arguments.
  if (p.knowledge?.trim())
    parts.push(
      `BASE DE CONNAISSANCE MÉTIER (apprise depuis le site web — utilise-la pour répondre précisément sur l'offre, les prix et les arguments de vente ; ne sors pas de ce périmètre) :\n${p.knowledge.trim()}`,
    );
  if (p.instructions?.trim())
    parts.push(`CONSIGNES :\n${p.instructions.trim()}`);
  if (p.successCriteria?.trim())
    parts.push(`CRITÈRE DE SUCCÈS :\n${p.successCriteria.trim()}`);
  parts.push(
    "INTERDICTION D'INVENTER : ne fabrique JAMAIS le nom de l'entreprise, le produit ou service vendu, ni les prix. Appuie-toi UNIQUEMENT sur l'objectif de l'appel et la base de connaissance ci-dessus. Si tu ne disposes pas de cette information, ne l'invente pas — reste général et propose de faire rappeler par un conseiller.",
  );
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
  const agentName = (campaign.persona?.agentName || "Sarah").trim();
  return `Ouvre l'appel ainsi : salue brièvement, présente-toi sous le prénom « ${agentName} » (et le nom de l'entreprise si tu le connais — JAMAIS « ${agentName} » remplacé par le nom de la marque), puis annonce EN UNE PHRASE la raison de ton appel ET l'offre/le produit principal, et enchaîne par une question d'engagement. Ne demande JAMAIS « que puis-je faire pour vous » : c'est toi qui appelles pour présenter une offre.`;
}
