// App-wide singleton settings (key/value). Currently used for the global
// system prompt that every tenant inherits in front of their own persona.

import { eq } from "drizzle-orm";

import {
  BLOCK_IDS,
  DEFAULT_CONFIG_BLOCKS_DIRECTIVE,
  DEFAULT_HANGUP_DIRECTIVE,
  DEFAULT_PER_CALL_CONTEXT_TEMPLATE,
  DEFAULT_PROMPT_BLOCK_ORDER,
  DEFAULT_SPOKEN_PHONE_DIRECTIVE,
  DEFAULT_SPOKEN_TIME_DIRECTIVE,
  type BlockId,
} from "@/lib/agent-prompt-defaults";
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
  // Directives système éditables — historiquement hardcodées dans agent.ts
  // du worker, maintenant pilotables depuis /admin pour qu'on maîtrise
  // tout le flow. Vide = fallback constants de lib/agent-prompt-defaults.ts.
  //
  // Singleton (pas per-plan) parce que ce sont des comportements universels
  // qui s'appliquent à tous les tenants : comment prononcer les heures,
  // les numéros, quand raccrocher. Per-plan n'a pas de sens ici.
  SPOKEN_TIME_DIRECTIVE: "spoken_time_directive",
  SPOKEN_PHONE_DIRECTIVE: "spoken_phone_directive",
  HANGUP_DIRECTIVE: "hangup_directive",
  // Template pour le contexte per-call injecté en chatCtx au début de
  // chaque appel. Contient des placeholders runtime — voir
  // lib/agent-prompt-defaults.ts pour la liste (date_fr, iso_date, time,
  // caller_hint_block). Le worker substitue.
  PER_CALL_CONTEXT_TEMPLATE: "per_call_context_template",
  // Bloc meta qui prime le LLM à respecter strictement les étapes du
  // persona (ne pas sauter en avant). Singleton, partagé tous tenants.
  CONFIG_BLOCKS_DIRECTIVE: "config_blocks_directive",
  // JSON array des IDs de blocs dans l'ordre où ils sont injectés dans
  // le system prompt. L'admin peut ré-ordonner depuis /admin. Si un ID
  // manque dans le tableau saved, on tombe sur DEFAULT_PROMPT_BLOCK_ORDER.
  PROMPT_BLOCK_ORDER: "prompt_block_order",
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

// ── Directives système (singleton, partagées tous tenants) ──────────────
// 4 fonctions get/set similaires pour les 4 textes éditables. Empty
// retournée = use the hardcoded default. Setter empty → DB vide (revient
// au default automatiquement).

export async function getSpokenTimeDirective(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.SPOKEN_TIME_DIRECTIVE)) ??
    DEFAULT_SPOKEN_TIME_DIRECTIVE
  );
}
export async function setSpokenTimeDirective(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.SPOKEN_TIME_DIRECTIVE, value);
}

export async function getSpokenPhoneDirective(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.SPOKEN_PHONE_DIRECTIVE)) ??
    DEFAULT_SPOKEN_PHONE_DIRECTIVE
  );
}
export async function setSpokenPhoneDirective(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.SPOKEN_PHONE_DIRECTIVE, value);
}

export async function getHangupDirective(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.HANGUP_DIRECTIVE)) ??
    DEFAULT_HANGUP_DIRECTIVE
  );
}
export async function setHangupDirective(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.HANGUP_DIRECTIVE, value);
}

export async function getPerCallContextTemplate(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.PER_CALL_CONTEXT_TEMPLATE)) ??
    DEFAULT_PER_CALL_CONTEXT_TEMPLATE
  );
}
export async function setPerCallContextTemplate(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.PER_CALL_CONTEXT_TEMPLATE, value);
}

export async function getConfigBlocksDirective(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.CONFIG_BLOCKS_DIRECTIVE)) ??
    DEFAULT_CONFIG_BLOCKS_DIRECTIVE
  );
}
export async function setConfigBlocksDirective(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.CONFIG_BLOCKS_DIRECTIVE, value);
}

// L'ordre des blocs est un array d'IDs. On valide à la lecture : on garde
// uniquement les IDs connus et on append en queue ceux manquants (au cas
// où on ajoute un nouveau bloc plus tard et que la setting saved
// précède). Fallback total sur DEFAULT_PROMPT_BLOCK_ORDER si parse fail.
export async function getPromptBlockOrder(): Promise<BlockId[]> {
  const raw = await getSetting(SETTING_KEYS.PROMPT_BLOCK_ORDER);
  if (!raw) return [...DEFAULT_PROMPT_BLOCK_ORDER];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_PROMPT_BLOCK_ORDER];
    const validSet = new Set<BlockId>(BLOCK_IDS);
    const seen = new Set<BlockId>();
    const result: BlockId[] = [];
    for (const x of parsed) {
      if (typeof x === "string" && validSet.has(x as BlockId) && !seen.has(x as BlockId)) {
        result.push(x as BlockId);
        seen.add(x as BlockId);
      }
    }
    // Append manquants (par défaut on garde toujours tous les blocs).
    for (const id of BLOCK_IDS) {
      if (!seen.has(id)) result.push(id);
    }
    return result;
  } catch {
    return [...DEFAULT_PROMPT_BLOCK_ORDER];
  }
}

export async function setPromptBlockOrder(order: BlockId[]): Promise<void> {
  // Same validation que getter : on garde seulement les IDs valides,
  // dédupe, append manquants. Garantit qu'on ne sauvegarde jamais un
  // état dégénéré.
  const validSet = new Set<BlockId>(BLOCK_IDS);
  const seen = new Set<BlockId>();
  const clean: BlockId[] = [];
  for (const x of order) {
    if (validSet.has(x) && !seen.has(x)) {
      clean.push(x);
      seen.add(x);
    }
  }
  for (const id of BLOCK_IDS) {
    if (!seen.has(id)) clean.push(id);
  }
  await setSetting(SETTING_KEYS.PROMPT_BLOCK_ORDER, JSON.stringify(clean));
}
