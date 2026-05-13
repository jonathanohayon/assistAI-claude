// App-wide singleton settings (key/value). Currently used for the global
// system prompt that every tenant inherits in front of their own persona.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { PLANS, type PlanKey } from "@/lib/plans";

export const SETTING_KEYS = {
  // Legacy : prompt unique appliqué à tous les plans. Conservé pour la
  // rétro-compat — utilisé en fallback si la nouvelle map per-plan n'a
  // pas encore été remplie. Lecture seule désormais ; les nouveaux écrits
  // passent par GLOBAL_INSTRUCTIONS_BY_PLAN.
  GLOBAL_INSTRUCTIONS: "global_instructions",
  // JSON map plan → prompt (Basique / Globale / Premium). Les "Règles
  // communes appliquées à chaque appel" sont éditables par plan depuis
  // /admin. Le bloc est concaténé devant la persona tenant dans
  // /api/agent/config selon subscriptionPlan.
  GLOBAL_INSTRUCTIONS_BY_PLAN: "global_instructions_by_plan",
  // Legacy : single onboarding template appliqué à tous les plans.
  // Conservé pour la rétro-compat. Les nouveaux écrits vont sur la map
  // ONBOARDING_TEMPLATE_BY_PLAN.
  ONBOARDING_TEMPLATE: "onboarding_persona_template",
  // JSON map plan → persona seedée à l'inscription. Permet à l'admin
  // d'avoir un texte par défaut différent par plan (basique = simple
  // take_message, globale/premium = Johana multi-centres). Empty pour un
  // plan donné → fallback INITIAL_INSTRUCTIONS_FOR_PLAN hardcodé.
  ONBOARDING_TEMPLATE_BY_PLAN: "onboarding_template_by_plan",
  // JSON map plan → feature flags (Calendar, CRM, etc.). Voir lib/plan-features.ts.
  PLAN_FEATURES: "plan_features",
  // JSON map plan → system prompt utilisé pour générer le résumé WhatsApp
  // post-appel (lib/summarize.ts). Permet d'avoir un ton/contenu/format
  // différents par plan (ex. basique = simple confirm message · global =
  // recap RDV pro · premium = ton VIP avec détails enrichis). Vide pour
  // un plan → fallback DEFAULT_SUMMARY_PROMPT hardcodé dans summarize.ts.
  SUMMARY_PROMPT_BY_PLAN: "summary_prompt_by_plan",
} as const;

export type GlobalInstructionsByPlan = Record<PlanKey, string>;

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getGlobalInstructions(): Promise<string> {
  return (await getSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS)) ?? "";
}

// Map plan → instructions. Si la nouvelle map n'a pas été touchée, on
// retombe sur l'ancien single-key pour TOUS les plans (= comportement
// d'avant la migration per-plan). Plans inconnus → string vide.
export async function getGlobalInstructionsByPlan(): Promise<GlobalInstructionsByPlan> {
  const raw = await getSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS_BY_PLAN);
  const legacy = await getGlobalInstructions();
  const out = Object.fromEntries(
    PLANS.map((p) => [p.key, legacy]),
  ) as GlobalInstructionsByPlan;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<PlanKey, string>>;
      for (const p of PLANS) {
        const v = parsed[p.key];
        if (typeof v === "string") out[p.key] = v;
      }
    } catch {
      // JSON corrompu → on garde le fallback legacy partout.
    }
  }
  return out;
}

export async function setGlobalInstructionsByPlan(
  map: Partial<GlobalInstructionsByPlan>,
): Promise<void> {
  // Hydrate avec la version actuelle pour ne pas effacer un plan absent
  // du payload (le formulaire envoie potentiellement seulement les
  // textareas modifiées).
  const current = await getGlobalInstructionsByPlan();
  const merged: GlobalInstructionsByPlan = { ...current };
  for (const p of PLANS) {
    const v = map[p.key];
    if (typeof v === "string") merged[p.key] = v;
  }
  await setSetting(
    SETTING_KEYS.GLOBAL_INSTRUCTIONS_BY_PLAN,
    JSON.stringify(merged),
  );
}

export async function getOnboardingTemplate(): Promise<string> {
  return (await getSetting(SETTING_KEYS.ONBOARDING_TEMPLATE)) ?? "";
}

export type OnboardingTemplateByPlan = Record<PlanKey, string>;

// Map plan → template d'inscription. Volontairement PAS de fallback sur
// l'ancien single-key `ONBOARDING_TEMPLATE` : ce dernier était écrit
// pour TOUS les plans (typiquement la persona globale Johana multi-
// centres), donc l'hériter silencieusement reproduit le bug "le basique
// reçoit la config d'un autre plan". Quand un plan n'a pas de texte
// dédié, on renvoie "" — le signup tombe alors sur la persona hardcodée
// per-plan de lib/initial-config.
export async function getOnboardingTemplateByPlan(): Promise<OnboardingTemplateByPlan> {
  const raw = await getSetting(SETTING_KEYS.ONBOARDING_TEMPLATE_BY_PLAN);
  const out = Object.fromEntries(
    PLANS.map((p) => [p.key, ""]),
  ) as OnboardingTemplateByPlan;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<PlanKey, string>>;
      for (const p of PLANS) {
        const v = parsed[p.key];
        if (typeof v === "string") out[p.key] = v;
      }
    } catch {
      // JSON corrompu → on garde "" partout (= hardcoded per-plan).
    }
  }
  return out;
}

export async function setOnboardingTemplateByPlan(
  map: Partial<OnboardingTemplateByPlan>,
): Promise<void> {
  const current = await getOnboardingTemplateByPlan();
  const merged: OnboardingTemplateByPlan = { ...current };
  for (const p of PLANS) {
    const v = map[p.key];
    if (typeof v === "string") merged[p.key] = v;
  }
  await setSetting(
    SETTING_KEYS.ONBOARDING_TEMPLATE_BY_PLAN,
    JSON.stringify(merged),
  );
}

export type SummaryPromptByPlan = Record<PlanKey, string>;

// Map plan → system prompt OpenAI utilisé pour générer le résumé
// WhatsApp post-appel. Vide pour un plan = fallback sur le hardcoded
// DEFAULT_SUMMARY_PROMPT (lib/summarize.ts). PAS de fallback sur
// l'ancien single-key (jamais existé), donc lecture "" par défaut.
export async function getSummaryPromptByPlan(): Promise<SummaryPromptByPlan> {
  const raw = await getSetting(SETTING_KEYS.SUMMARY_PROMPT_BY_PLAN);
  const out = Object.fromEntries(
    PLANS.map((p) => [p.key, ""]),
  ) as SummaryPromptByPlan;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<PlanKey, string>>;
      for (const p of PLANS) {
        const v = parsed[p.key];
        if (typeof v === "string") out[p.key] = v;
      }
    } catch {
      // JSON corrompu → "" partout (= fallback hardcoded).
    }
  }
  return out;
}

export async function setSummaryPromptByPlan(
  map: Partial<SummaryPromptByPlan>,
): Promise<void> {
  const current = await getSummaryPromptByPlan();
  const merged: SummaryPromptByPlan = { ...current };
  for (const p of PLANS) {
    const v = map[p.key];
    if (typeof v === "string") merged[p.key] = v;
  }
  await setSetting(
    SETTING_KEYS.SUMMARY_PROMPT_BY_PLAN,
    JSON.stringify(merged),
  );
}
