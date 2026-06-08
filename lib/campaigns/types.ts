// DTOs partagés entre les composants client du workspace campagnes et les
// réponses des routes API. CLIENT-SAFE.

import type {
  CallWindow,
  CampaignPersona,
  CampaignStatus,
  ContactStatus,
  ExtractionField,
  GoalPreset,
  RetryRules,
} from "./constants";

export type CampaignStats = {
  total: number;
  queued: number;
  inFlight: number;
  done: number;
  connected: number;
  conversion: number;
};

export type CampaignDTO = {
  id: string;
  userId: string;
  name: string;
  goalPreset: GoalPreset;
  objective: string;
  status: CampaignStatus;
  fromNumber: string;
  persona: CampaignPersona;
  extractionSchema: ExtractionField[];
  concurrency: number;
  retryRules: RetryRules;
  callWindow: CallWindow;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type CampaignListItem = CampaignDTO & { stats: CampaignStats };

export type CampaignContactDTO = {
  id: string;
  campaignId: string;
  phoneNumber: string;
  contactName: string;
  vars: Record<string, string>;
  status: ContactStatus;
  attempts: number;
  createdAt: string;
};

export type CampaignCallDTO = {
  id: string;
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  outcome: string;
  disposition: string;
  sentiment: string;
  summary: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  extracted: Record<string, unknown>;
  durationSeconds: number;
  createdAt: string;
};

// Draft d'édition d'une campagne (création ou modification).
export type CampaignDraft = {
  id?: string;
  name: string;
  goalPreset: GoalPreset;
  objective: string;
  fromNumber: string;
  persona: CampaignPersona;
  extractionSchema: ExtractionField[];
  concurrency: number;
  retryRules: RetryRules;
  callWindow: CallWindow;
};
