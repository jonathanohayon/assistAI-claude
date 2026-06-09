// Unions de strings partagées par l'API web, les routes worker et l'UI.
// CLIENT-SAFE — aucun import server-only ici (importé depuis les composants
// "use client" du workspace campagnes).

export const GOAL_PRESETS = [
  "cold",
  "sales",
  "lead_gen",
  "marketing",
  "custom",
] as const;
export type GoalPreset = (typeof GOAL_PRESETS)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "running",
  "paused",
  "completed",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Statuts d'un contact dans la file d'attente.
export const CONTACT_STATUSES = [
  "queued",
  "claimed",
  "calling",
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "skipped",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

// Statuts non-terminaux (en vol) — comptent dans la limite de concurrence.
export const IN_FLIGHT_STATUSES: ContactStatus[] = ["claimed", "calling"];

// Résultat d'un appel terminé.
export const CALL_OUTCOMES = [
  "connected",
  "no_answer",
  "voicemail",
  "busy",
  "failed",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

// Dispositions auto-classifiées par l'IA après l'appel.
export const DISPOSITIONS = [
  "interested",
  "not_interested",
  "callback",
  "qualified",
  "meeting_booked",
  "do_not_call",
  "wrong_number",
  "no_decision",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const EXTRACTION_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "enum",
] as const;
export type ExtractionFieldType = (typeof EXTRACTION_FIELD_TYPES)[number];

export type ExtractionField = {
  key: string;
  label: string;
  type: ExtractionFieldType;
  options?: string[];
  required?: boolean;
};

export type RetryRules = {
  maxAttempts: number;
  retryOn: Array<"no_answer" | "busy" | "voicemail" | "failed">;
  backoffMinutes: number;
};

export type CallWindow = {
  timezone: string;
  days: number[];
  startHour: number;
  endHour: number;
  respectDnc: boolean;
};

// Défauts utilisés par l'UI de création et la normalisation serveur.
export const DEFAULT_RETRY_RULES: RetryRules = {
  maxAttempts: 1,
  retryOn: [],
  backoffMinutes: 60,
};

export const DEFAULT_CALL_WINDOW: CallWindow = {
  timezone: "Asia/Jerusalem",
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  respectDnc: true,
};

export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 20;

// Garde-fou import / saisie.
export const MAX_CONTACTS_PER_IMPORT = 5000;
