// Server-side localized plan content. Lit messages/<locale>.json à la
// volée. Pas de dépendance next-intl request context — utilisable depuis
// emails (out-of-request), onboarding, billing, settings.
//
// Fallback systématique : si la locale demandée n'a pas la clé, retombe
// sur les valeurs hardcodées de lib/plans.ts (= FR). Évite un trou visuel
// si une feature est ajoutée et oubliée en traduction.

import { type Plan, planByKey } from "@/lib/plans";
import { routing, type Locale } from "@/i18n/routing";

import fr from "@/messages/fr.json";
import he from "@/messages/he.json";
import en from "@/messages/en.json";

const MESSAGES: Record<Locale, typeof fr> = { fr, he, en };

interface PlanContent {
  name: string;
  tagline: string;
  features: string[];
  onboardingNotes: string[];
  // Pass-through pour les champs structurels — pas de traduction.
  key: Plan["key"];
  monthly: number;
  annualMonthly: number;
  annualTotal: number;
  model: string;
  popular?: boolean;
}

function normalizeLocale(locale: string | null | undefined): Locale {
  if (!locale) return routing.defaultLocale;
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

export function getLocalizedPlan(
  locale: string | null | undefined,
  planKey: string | null | undefined,
): PlanContent {
  const plan = planByKey(planKey);
  const loc = normalizeLocale(locale);
  const messages = MESSAGES[loc] as unknown as {
    Plans?: Record<
      string,
      {
        name?: string;
        tagline?: string;
        features?: string[];
        onboardingNotes?: string[];
      }
    >;
  };
  const block = messages.Plans?.[plan.key];

  return {
    key: plan.key,
    monthly: plan.monthly,
    annualMonthly: plan.annualMonthly,
    annualTotal: plan.annualTotal,
    model: plan.model,
    popular: plan.popular,
    name: block?.name ?? plan.name,
    tagline: block?.tagline ?? plan.tagline,
    features: block?.features ?? Array.from(plan.features),
    onboardingNotes:
      block?.onboardingNotes ?? Array.from(plan.onboardingNotes),
  };
}
