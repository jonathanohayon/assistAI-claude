// DTOs partagés entre les composants client (workspace Appels sortants) et les
// routes API des agents sortants réutilisables. CLIENT-SAFE.

export type AgentNotifications = { whatsapp?: string; email?: string };
export type AgentChannels = { phone?: boolean; whatsappVoice?: boolean };

export type OutboundAgentDTO = {
  id: string;
  userId: string;
  name: string;
  agentName: string;
  voice: string;
  language: string;
  instructions: string;
  greeting: string;
  knowledge: string;
  knowledgeSources: string[];
  notifications: AgentNotifications;
  channels: AgentChannels;
  createdAt: string;
  updatedAt: string;
};

// L'agent enrichi du nombre de campagnes qui l'utilisent (pour avertir avant
// suppression / afficher l'usage dans la liste).
export type OutboundAgentListItem = OutboundAgentDTO & { campaignCount: number };

// Draft d'édition d'un agent (création ou modification). Mêmes champs que le
// DTO, sans les métadonnées serveur.
export type OutboundAgentDraft = {
  id?: string;
  name: string;
  agentName: string;
  voice: string;
  language: string;
  instructions: string;
  greeting: string;
  knowledge: string;
  knowledgeSources: string[];
  notifications: AgentNotifications;
  channels: AgentChannels;
};

export function emptyAgentDraft(language: string, name = ""): OutboundAgentDraft {
  return {
    name,
    agentName: "Sarah",
    voice: "marin",
    language: language || "fr",
    instructions: "",
    greeting: "",
    knowledge: "",
    knowledgeSources: [],
    notifications: {},
    channels: { phone: true },
  };
}
