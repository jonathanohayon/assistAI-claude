/**
 * Types & constantes partagés du formulaire de configuration (/dashboard).
 *
 * Contient : FormState (état complet du formulaire), la structure métier
 * BusinessConfig (centres + horaires hebdo + soins/tarifs), les types de
 * numéros (ChannelNumber), les stats du hero, et les valeurs par défaut
 * (DEFAULT_BUSINESS, DEFAULT_WEEKLY_HOURS, WEEKDAY_ORDER).
 *
 * Utilisé par : config-form.tsx (orchestrateur) et tous les modules de
 * app/[locale]/dashboard/config/. DEFAULT_BUSINESS et les types Business*
 * sont aussi ré-exportés par config-form.tsx pour les importeurs externes
 * (dashboard/page, dashboard-preview, admin/users/[userId], website-scan-wizard).
 */

import type { useTranslations } from "next-intl";

import type { PERSONALITY_KEYS } from "@/lib/personality";

/** Fonction de traduction scoped sur le namespace "DashboardConfig" —
 *  passée en prop `t` à la plupart des sous-composants. */
export type Translator = ReturnType<typeof useTranslations<"DashboardConfig">>;

export type Personality = Partial<
  Record<(typeof PERSONALITY_KEYS)[number], number>
>;

export type FormState = {
  instructions: string;
  greetingInstructions: string;
  model: string;
  voice: string;
  temperature: number;
  speed: number;
  maxResponseTokens: number;
  ownerWhatsapp: string;
  primaryLanguage: string;
  /** Rappel WhatsApp automatique au client la veille de son RDV (cron J-1). */
  reminderEnabled: boolean;
  inheritAdminGlobals: boolean;
  personality: Personality;
  agentName: string;
  /** Slider 1-10 piloté ici, envoyé tel quel au PUT puis exposé à
   *  /api/agent/config pour le worker qui le mappe en enhancementLevel 0.1-1.0
   *  du QVF 2.1 L (ai-coustics). 1 = passthrough, 8 = équilibré, 10 = agressif. */
  noiseReductionLevel: number;
  /** Structure métier du tenant : identité + centres (avec horaires hebdo) +
   *  soins/tarifs. Remplace l'ancienne `knowledge` libre — exposé tel quel
   *  au worker via /api/agent/config qui en dérive les tools dynamiques. */
  business: BusinessConfig;
};

/** Setter typé d'un champ du formulaire — fourni par ConfigForm (marque
 *  aussi le formulaire dirty + gère la cohérence model/voice). */
export type FormUpdater = <K extends keyof FormState>(
  key: K,
  value: FormState[K],
) => void;

export type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayHours = {
  open: boolean;
  openTime: string;
  closeTime: string;
};

export type WeeklyHours = Record<WeekDay, DayHours>;

export type BusinessCentre = {
  id: string;
  name: string;
  address: string;
  hours: WeeklyHours;
};

export type BusinessService = {
  id: string;
  name: string;
  durationMinutes: number;
  priceILS: number;
  /** "all" sentinel = dispo dans tous les centres ; sinon liste d'IDs. */
  centreIds: string[] | "all";
  description: string;
};

export type BusinessConfig = {
  identity: { name: string; tagline: string; email: string };
  centres: BusinessCentre[];
  services: BusinessService[];
  /** Texte libre optionnel injecté dans le system prompt sous une section
   *  "Centers and Days Rules (STRICT — NON-NEGOTIABLE)". Permet au tenant
   *  d'encoder ses contraintes métier non-représentables par le grid horaires
   *  (ex. "Natanya uniquement le mercredi", blackout dates, etc.).
   *  Vide → la section n'est pas injectée du tout. */
  centresRules?: string;
  /** Base de connaissances vente/expertise (corps de métier, descriptions
   *  détaillées, détails techniques, arguments de vente). Alimentée par le scan
   *  du site, injectée dans le system prompt. Vide → non injectée. */
  knowledgeBase?: string;
};

/** Un numéro tenant tel que renvoyé par /api/dashboard/channels — le canal
 *  est dérivé du préfixe `whatsapp:` côté serveur et phoneNumber est déjà
 *  nettoyé pour l'affichage. */
export type ChannelNumber = {
  id: string;
  phoneNumber: string;
  channel: "pstn" | "whatsapp";
  label: string;
  countryCode: string;
};

/** Stats affichées dans le hero (appels du jour, conversion, etc.) —
 *  calculées côté serveur par dashboard/page.tsx. */
export type DashboardStats = {
  callsToday: number;
  conversion: number;
  avgDuration: string;
  rdv: number;
  minutesThisMonth: number;
};

export const WEEKDAY_ORDER: readonly WeekDay[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: { open: true, openTime: "09:00", closeTime: "18:00" },
  tue: { open: true, openTime: "09:00", closeTime: "18:00" },
  wed: { open: true, openTime: "09:00", closeTime: "18:00" },
  thu: { open: true, openTime: "09:00", closeTime: "18:00" },
  fri: { open: true, openTime: "09:00", closeTime: "14:00" },
  sat: { open: false, openTime: "09:00", closeTime: "18:00" },
  sun: { open: true, openTime: "09:00", closeTime: "18:00" },
};

export const DEFAULT_BUSINESS: BusinessConfig = {
  identity: { name: "", tagline: "", email: "" },
  centres: [],
  services: [],
  centresRules: "",
};
