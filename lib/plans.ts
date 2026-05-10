// Single source of truth for subscription plans. Imported by:
// - components/marketing/Pricing.tsx (public landing)
// - app/signup/page.tsx (capture chosen plan)
// - app/onboarding/* (plan recap)
// - app/dashboard/billing/* (upgrade/downgrade UI)
//
// Keep keys stable — they're stored on users.subscription_plan in the DB.

export type PlanKey = "essential" | "whatsapp" | "global" | "premium";

export interface Plan {
  key: PlanKey;
  name: string;
  tagline: string;
  monthly: number;
  annualTotal: number;
  annualMonthly: number;
  model: string;
  popular?: boolean;
  features: string[];
  /**
   * Plan-specific copy shown on the onboarding recap card. Empty array =
   * use the default features list.
   */
  onboardingNotes: string[];
}

export const PLANS: readonly Plan[] = [
  {
    key: "essential",
    name: "Essentielle",
    tagline: "Pour démarrer en douceur.",
    monthly: 59,
    annualTotal: 590,
    annualMonthly: 49,
    model: "gpt-realtime-mini",
    features: [
      "500 minutes de conversation / mois",
      "Voix naturelle bilingue FR / Hébreu",
      "Prise de rendez-vous vocale",
    ],
    onboardingNotes: [
      "Tu démarres avec 500 minutes / mois et un numéro Twilio dédié.",
      "Connecte Google Calendar pour activer la prise de RDV vocale.",
    ],
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    tagline: "Le choix de la majorité des centres.",
    monthly: 99,
    annualTotal: 990,
    annualMonthly: 82,
    model: "gpt-realtime-mini",
    popular: true,
    features: [
      "Tout de la formule Essentielle",
      "800 minutes / mois",
      "Confirmation WhatsApp automatique",
      "Résumé de conversation par email",
    ],
    onboardingNotes: [
      "Confirmations WhatsApp activées : tes clientes recevront un message automatique après chaque RDV.",
      "Renseigne ton numéro WhatsApp owner pour recevoir les recaps d'appels.",
    ],
  },
  {
    key: "global",
    name: "Globale",
    tagline: "Pour gérer plusieurs centres.",
    monthly: 179,
    annualTotal: 1790,
    annualMonthly: 149,
    model: "gpt-realtime-mini",
    features: [
      "Tout de la formule WhatsApp",
      "1 200 minutes / mois",
      "Agenda Google complet (3 centres)",
      "CRM Google Sheet fourni & synchronisé",
    ],
    onboardingNotes: [
      "Tu peux rattacher jusqu'à 3 centres / calendriers distincts.",
      "Le CRM Google Sheet sera créé et partagé avec toi pendant la connexion Google.",
    ],
  },
  {
    key: "premium",
    name: "Premium Entreprise",
    tagline: "Sans limite, configuration sur mesure.",
    monthly: 299,
    annualTotal: 2990,
    annualMonthly: 249,
    model: "gpt-realtime-1.5",
    features: [
      "Modèle gpt-realtime-1.5 (ultra naturel)",
      "Minutes illimitées",
      "Agenda + CRM complet",
      "WhatsApp + Résumé + historique",
      "Configuration sur mesure & support dédié",
    ],
    onboardingNotes: [
      "Notre équipe te contactera sous 24h pour la configuration sur mesure (persona, voix, workflows).",
      "Modèle gpt-realtime-1.5 activé automatiquement après l'onboarding.",
    ],
  },
] as const;

export const DEFAULT_PLAN_KEY: PlanKey = "essential";

export function planByKey(key: string | null | undefined): Plan {
  const found = PLANS.find((p) => p.key === key);
  return found ?? PLANS[0];
}

export function isValidPlanKey(key: string | null | undefined): key is PlanKey {
  return PLANS.some((p) => p.key === key);
}

export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}
