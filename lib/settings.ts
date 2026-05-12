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
  // Default persona seeded into a new tenant's agent_config at signup time.
  // Empty → fall back to the hard-coded INITIAL_INSTRUCTIONS in lib/initial-config.
  ONBOARDING_TEMPLATE: "onboarding_persona_template",
  // JSON map plan → feature flags (Calendar, CRM, etc.). Voir lib/plan-features.ts.
  PLAN_FEATURES: "plan_features",
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
