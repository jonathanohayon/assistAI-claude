// Single source of truth for subscription plans. Imported by:
// - components/marketing/Pricing.tsx (public landing)
// - app/signup/page.tsx (capture chosen plan)
// - app/onboarding/* (plan recap)
// - app/dashboard/billing/* (upgrade/downgrade UI)
//
// Keep keys stable — they're stored on users.subscription_plan in the DB.

export type PlanKey = "whatsapp" | "global" | "premium";

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
  /** "Best for: …" audience hint shown below the features list. */
  bestFor: string;
  /**
   * Plan-specific copy shown on the onboarding recap card. Empty array =
   * use the default features list.
   */
  onboardingNotes: string[];
}

export const PLANS: readonly Plan[] = [
  {
    key: "whatsapp",
    name: "Permanence téléphonique",
    tagline: "Réponse aux appels par IA, 24/7.",
    monthly: 149,
    annualTotal: 1485,
    annualMonthly: 123,
    model: "gpt-realtime",
    features: [
      "500 minutes incluses",
      "Prise d'appels automatisée 24/7",
      "Messages vocaux transcrits et résumés par l'IA, envoyés sur WhatsApp ou email",
      "Message d'accueil personnalisé",
      "Filtrage intelligent des appels spam",
      "Rapports d'activité hebdomadaires",
      "Intégration CRM & agenda",
    ],
    bestFor: "freelances, indépendants et petites entreprises",
    onboardingNotes: [
      "Confirmations WhatsApp activées : tes clientes recevront un message automatique après chaque RDV.",
      "Renseigne ton numéro WhatsApp owner pour recevoir les recaps d'appels.",
    ],
  },
  {
    key: "global",
    name: "Réceptionniste",
    tagline: "Votre réceptionniste virtuelle intelligente.",
    monthly: 269,
    annualTotal: 2685,
    annualMonthly: 224,
    model: "gpt-realtime",
    popular: true,
    features: [
      "500 minutes incluses",
      "Tout ce qui est inclus dans Permanence téléphonique",
      "Qualification des appelants et prise de rendez-vous automatique",
      "Réponses aux questions fréquentes",
      "Transfert d'appel intelligent vers toi ou ton équipe",
      "Voix naturelle et professionnelle",
      "Intégration CRM & agenda",
    ],
    bestFor: "consultants, agences, cliniques et services B2B",
    onboardingNotes: [
      "Tu peux rattacher jusqu'à 3 centres / calendriers distincts.",
      "Le CRM Google Sheet sera créé et partagé avec toi pendant la connexion Google.",
    ],
  },
  {
    key: "premium",
    name: "Centre d'appels pro",
    tagline: "Votre centre d'appels complet propulsé par l'IA.",
    monthly: 449,
    annualTotal: 4485,
    annualMonthly: 374,
    model: "gpt-realtime",
    features: [
      "500 minutes incluses",
      "Tout ce qui est inclus dans Réceptionniste",
      "Gestion de plusieurs appels simultanés",
      "Tableau de bord analytics en temps réel",
      "Routage avancé et scénarios complexes",
      "Intégrations CRM et outils approfondies",
      "Support prioritaire",
    ],
    bestFor: "entreprises en croissance et équipes qui montent en charge sur leur support téléphonique",
    onboardingNotes: [
      "Notre équipe te contactera sous 24h pour la configuration sur mesure (persona, voix, workflows).",
      "Modèle gpt-realtime activé automatiquement après l'onboarding.",
    ],
  },
] as const;

export const DEFAULT_PLAN_KEY: PlanKey = "whatsapp";

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
