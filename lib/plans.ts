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
  /**
   * Offered on the public pricing / signup (2026-11 grid: Réceptionniste and
   * Clinique). false = legacy plan kept only for existing subscribers.
   */
  public: boolean;
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
export const OVERAGE_RATE_ILS_PER_MIN = 0.9;

/**
 * Feature copy (here and in messages/*.json) writes the included minutes as
 * `{minutes}` so the number lives only in `minutesIncluded`. Call this
 * wherever a feature list is displayed.
 */
export function fillPlanFeatures(plan: Pick<Plan, "minutesIncluded">, features: readonly string[]): string[] {
  return features.map((f) => f.replaceAll("{minutes}", String(plan.minutesIncluded)));
}

export const PLANS: readonly Plan[] = [
  {
    key: "global",
    name: "Réceptionniste",
    tagline: "Vos rendez-vous pris automatiquement, 24/7.",
    // EUR shown abroad; ILS (₪349) in lib/plan-pricing.ts. 2026-11 grid.
    monthly: 89,
    annualTotal: 890,
    annualMonthly: 74,
    model: "gpt-realtime",
    popular: true,
    minutesIncluded: 300,
    public: true,
    features: [
      "{minutes} minutes incluses",
      "Prise d'appels et de rendez-vous automatique, 24/7",
      "Calendrier connecté & CRM",
      "Récap de chaque appel sur WhatsApp",
      "Réponses aux questions fréquentes",
      "Voix naturelle, en français, hébreu et anglais",
    ],
    excludedFeatures: [],
    bestFor: "salons, cabinets et commerces avec un seul établissement",
    onboardingNotes: [
      "Le CRM Google Sheet sera créé et partagé avec toi pendant la connexion Google.",
      "Renseigne ton numéro WhatsApp pour recevoir les récaps d'appels.",
    ],
  },
  {
    key: "premium",
    name: "Clinique / Multi-sites",
    tagline: "Plusieurs établissements, un seul accueil téléphonique.",
    // EUR shown abroad; ILS (₪649) in lib/plan-pricing.ts. 2026-11 grid.
    monthly: 169,
    annualTotal: 1690,
    annualMonthly: 141,
    model: "gpt-realtime",
    minutesIncluded: 800,
    public: true,
    features: [
      "{minutes} minutes incluses",
      "Tout ce qui est inclus dans Réceptionniste",
      "Jusqu'à 3 établissements / calendriers",
      "Tableau de bord analytics en temps réel",
      "Support prioritaire",
    ],
    excludedFeatures: [],
    bestFor: "cliniques et entreprises multi-sites",
    onboardingNotes: [
      "Tu peux rattacher jusqu'à 3 établissements / calendriers distincts.",
      "Notre équipe te contactera sous 24h pour la configuration (persona, voix, centres).",
    ],
  },
  {
    key: "whatsapp",
    name: "Permanence téléphonique",
    tagline: "Ne ratez plus jamais un appel.",
    monthly: 59,
    annualTotal: 588,
    annualMonthly: 49,
    model: "gpt-realtime",
    minutesIncluded: 300,
    // Legacy (2026-11): no longer offered; existing subscribers keep it.
    public: false,
    features: [
      "{minutes} minutes incluses",
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
] as const;

/** Plans offered on the public pricing and at signup (2026-11 grid). */
export const PUBLIC_PLANS: readonly Plan[] = PLANS.filter((p) => p.public);

/**
 * A plan this customer may pay for: any public plan, or their current legacy
 * plan (a Permanence subscriber can renew it; nobody else can buy it).
 */
export function canPurchasePlan(key: string | null | undefined, currentPlan: string | null | undefined): boolean {
  if (!isValidPlanKey(key)) return false;
  return isPublicPlanKey(key) || key === currentPlan;
}

/** A plan a NEW customer may pick (legacy plans stay valid for existing ones). */
export function isPublicPlanKey(key: string | null | undefined): key is PlanKey {
  return PUBLIC_PLANS.some((p) => p.key === key);
}

export const DEFAULT_PLAN_KEY: PlanKey = "global";

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
