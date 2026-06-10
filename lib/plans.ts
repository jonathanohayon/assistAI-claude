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
  /** Minutes vocales incluses par mois. Utilisé pour le calcul d'overage. */
  minutesIncluded: number;
  features: string[];
  /**
   * Features volontairement exclues du plan, affichées avec ✗ pour rendre
   * lisible la différence vs les plans supérieurs (ex: basic n'a pas de CRM).
   */
  excludedFeatures: string[];
  /** "Best for: …" audience hint shown below the features list. */
  bestFor: string;
  /**
   * Plan-specific copy shown on the onboarding recap card. Empty array =
   * use the default features list.
   */
  onboardingNotes: string[];
}

/**
 * Tarif d'overage (minutes hors forfait) en shekel — source de vérité.
 * Converti dans la devise affichée côté pricing card via le fx rate ILS.
 */
export const OVERAGE_RATE_ILS_PER_MIN = 0.6;

export const PLANS: readonly Plan[] = [
  {
    key: "whatsapp",
    name: "Permanence téléphonique",
    tagline: "Ne ratez plus jamais un appel.",
    monthly: 59,
    annualTotal: 588,
    annualMonthly: 49,
    model: "gpt-realtime",
    minutesIncluded: 300,
    features: [
      "300 minutes incluses",
      "Prise d'appels automatisée 24/7",
      "Messages vocaux transcrits et résumés par l'IA, envoyés sur WhatsApp ou email",
      "Message d'accueil personnalisé",
      "Filtrage intelligent des appels spam",
      "Rapports d'activité hebdomadaires",
    ],
    excludedFeatures: [
      "Intégration CRM",
      "Calendrier connecté (prise de RDV)",
    ],
    bestFor: "indépendants, commerces et petites équipes",
    onboardingNotes: [
      "Confirmations WhatsApp activées : tes clientes recevront un message automatique après chaque RDV.",
      "Renseigne ton numéro WhatsApp owner pour recevoir les recaps d'appels.",
    ],
  },
  {
    key: "global",
    name: "Réceptionniste",
    tagline: "Vos rendez-vous pris automatiquement, 24/7.",
    monthly: 129,
    annualTotal: 1284,
    annualMonthly: 107,
    model: "gpt-realtime",
    popular: true,
    minutesIncluded: 500,
    features: [
      "500 minutes incluses",
      "Tout ce qui est inclus dans Permanence téléphonique",
      "Intégration CRM & calendrier connecté",
      "Qualification des appelants et prise de rendez-vous automatique",
      "Réponses aux questions fréquentes",
      "Transfert d'appel intelligent vers toi ou ton équipe",
      "Voix naturelle et professionnelle",
    ],
    excludedFeatures: [],
    bestFor: "cabinets, cliniques, agences et services B2B",
    onboardingNotes: [
      "Tu peux rattacher jusqu'à 3 centres / calendriers distincts.",
      "Le CRM Google Sheet sera créé et partagé avec toi pendant la connexion Google.",
    ],
  },
  {
    key: "premium",
    name: "Centre d'appels pro",
    tagline: "Votre centre d'appels entrants & sortants, propulsé par l'IA.",
    monthly: 299,
    annualTotal: 2988,
    annualMonthly: 249,
    model: "gpt-realtime",
    minutesIncluded: 1500,
    features: [
      "Centre d'appels sortant : campagnes IA (prospection, relances, rappels no-show)",
      "Appels entrants & sortants en parallèle",
      "1500 minutes incluses",
      "Tableau de bord analytics en temps réel",
      "Routage avancé et scénarios complexes",
      "Tout ce qui est inclus dans Réceptionniste",
      "Support prioritaire",
    ],
    excludedFeatures: [],
    bestFor: "centres d'appels, équipes sales et support à fort volume",
    onboardingNotes: [
      "Notre équipe te contactera sous 24h pour la configuration sur mesure (persona, voix, workflows).",
      "Modèle gpt-realtime activé automatiquement après l'onboarding.",
    ],
  },
] as const;

export const DEFAULT_PLAN_KEY: PlanKey = "whatsapp";

/**
 * Plan sur lequel tout compte en essai gratuit est provisionné.
 *
 * L'essai gratuit donne accès à TOUTES les fonctionnalités (y compris les
 * appels sortants Premium). On provisionne donc systématiquement les comptes
 * en trial sur "premium" pour exposer l'intégralité des features pendant la
 * durée de l'essai. Le choix réel du plan se fait plus tard, au moment du
 * paiement (page billing).
 */
export const TRIAL_PLAN_KEY: PlanKey = "premium";

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
