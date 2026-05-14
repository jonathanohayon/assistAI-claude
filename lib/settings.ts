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
  // Singleton legacy (lecture seule désormais) : conservé pour rétro-
  // compat — toutes les nouvelles écritures passent par les maps per-plan
  // (_BY_PLAN). Les getters singleton sont utilisés en fallback dans les
  // getters per-plan si un plan donné n'a rien stocké.
  SPOKEN_TIME_DIRECTIVE: "spoken_time_directive",
  SPOKEN_PHONE_DIRECTIVE: "spoken_phone_directive",
  HANGUP_DIRECTIVE: "hangup_directive",
  PER_CALL_CONTEXT_TEMPLATE: "per_call_context_template",
  CONFIG_BLOCKS_DIRECTIVE: "config_blocks_directive",
  // Per-plan : chaque plan a sa propre version de chaque directive.
  // JSON map plan → string. Vide pour un plan donné → fallback singleton
  // legacy → fallback DEFAULT hardcoded. Permet à l'admin de différencier
  // le ton/style/règles entre Basique / Globale / Premium.
  SPOKEN_TIME_DIRECTIVE_BY_PLAN: "spoken_time_directive_by_plan",
  SPOKEN_PHONE_DIRECTIVE_BY_PLAN: "spoken_phone_directive_by_plan",
  HANGUP_DIRECTIVE_BY_PLAN: "hangup_directive_by_plan",
  PER_CALL_CONTEXT_TEMPLATE_BY_PLAN: "per_call_context_template_by_plan",
  CONFIG_BLOCKS_DIRECTIVE_BY_PLAN: "config_blocks_directive_by_plan",
  // JSON array des IDs de blocs dans l'ordre où ils sont injectés dans
  // le system prompt. Legacy singleton, conservé en fallback.
  PROMPT_BLOCK_ORDER: "prompt_block_order",
  // JSON map plan → array d'IDs. Chaque plan peut avoir son propre ordre
  // de blocs. Fallback sur singleton legacy si plan absent.
  PROMPT_BLOCK_ORDER_BY_PLAN: "prompt_block_order_by_plan",
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

// ── Per-plan getters/setters pour les directives système ────────────────
// Chaque plan a son propre texte. Lecture en cascade pour un plan donné :
//   1. JSON map per-plan en DB
//   2. fallback sur le singleton legacy si plan absent dans la map
//   3. fallback final sur DEFAULT_* hardcoded
// Une chaîne vide saved dans la map per-plan est intentionnelle (admin a
// explicitement vidé pour ce plan) → on retourne "" (= bloc supprimé).
//
// Helper générique pour ne pas dupliquer le pattern 5 fois.
type PlanStringMap = Record<PlanKey, string>;

async function readByPlanMap(
  key: string,
  legacyKey: string,
  fallback: string,
): Promise<PlanStringMap> {
  const [raw, legacy] = await Promise.all([
    getSetting(key),
    getSetting(legacyKey),
  ]);
  const legacyResolved = legacy ?? fallback;
  const out = Object.fromEntries(
    PLANS.map((p) => [p.key, legacyResolved]),
  ) as PlanStringMap;
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

async function writeByPlanMap(
  key: string,
  current: PlanStringMap,
  patch: Partial<PlanStringMap>,
): Promise<void> {
  const merged: PlanStringMap = { ...current };
  for (const p of PLANS) {
    const v = patch[p.key];
    if (typeof v === "string") merged[p.key] = v;
  }
  await setSetting(key, JSON.stringify(merged));
}

export type SpokenTimeDirectiveByPlan = PlanStringMap;
export async function getSpokenTimeDirectiveByPlan(): Promise<SpokenTimeDirectiveByPlan> {
  return readByPlanMap(
    SETTING_KEYS.SPOKEN_TIME_DIRECTIVE_BY_PLAN,
    SETTING_KEYS.SPOKEN_TIME_DIRECTIVE,
    DEFAULT_SPOKEN_TIME_DIRECTIVE,
  );
}
export async function setSpokenTimeDirectiveByPlan(
  patch: Partial<SpokenTimeDirectiveByPlan>,
): Promise<void> {
  const current = await getSpokenTimeDirectiveByPlan();
  await writeByPlanMap(
    SETTING_KEYS.SPOKEN_TIME_DIRECTIVE_BY_PLAN,
    current,
    patch,
  );
}

export type SpokenPhoneDirectiveByPlan = PlanStringMap;
export async function getSpokenPhoneDirectiveByPlan(): Promise<SpokenPhoneDirectiveByPlan> {
  return readByPlanMap(
    SETTING_KEYS.SPOKEN_PHONE_DIRECTIVE_BY_PLAN,
    SETTING_KEYS.SPOKEN_PHONE_DIRECTIVE,
    DEFAULT_SPOKEN_PHONE_DIRECTIVE,
  );
}
export async function setSpokenPhoneDirectiveByPlan(
  patch: Partial<SpokenPhoneDirectiveByPlan>,
): Promise<void> {
  const current = await getSpokenPhoneDirectiveByPlan();
  await writeByPlanMap(
    SETTING_KEYS.SPOKEN_PHONE_DIRECTIVE_BY_PLAN,
    current,
    patch,
  );
}

export type HangupDirectiveByPlan = PlanStringMap;
export async function getHangupDirectiveByPlan(): Promise<HangupDirectiveByPlan> {
  return readByPlanMap(
    SETTING_KEYS.HANGUP_DIRECTIVE_BY_PLAN,
    SETTING_KEYS.HANGUP_DIRECTIVE,
    DEFAULT_HANGUP_DIRECTIVE,
  );
}
export async function setHangupDirectiveByPlan(
  patch: Partial<HangupDirectiveByPlan>,
): Promise<void> {
  const current = await getHangupDirectiveByPlan();
  await writeByPlanMap(
    SETTING_KEYS.HANGUP_DIRECTIVE_BY_PLAN,
    current,
    patch,
  );
}

export type PerCallContextTemplateByPlan = PlanStringMap;
export async function getPerCallContextTemplateByPlan(): Promise<PerCallContextTemplateByPlan> {
  return readByPlanMap(
    SETTING_KEYS.PER_CALL_CONTEXT_TEMPLATE_BY_PLAN,
    SETTING_KEYS.PER_CALL_CONTEXT_TEMPLATE,
    DEFAULT_PER_CALL_CONTEXT_TEMPLATE,
  );
}
export async function setPerCallContextTemplateByPlan(
  patch: Partial<PerCallContextTemplateByPlan>,
): Promise<void> {
  const current = await getPerCallContextTemplateByPlan();
  await writeByPlanMap(
    SETTING_KEYS.PER_CALL_CONTEXT_TEMPLATE_BY_PLAN,
    current,
    patch,
  );
}

export type ConfigBlocksDirectiveByPlan = PlanStringMap;
export async function getConfigBlocksDirectiveByPlan(): Promise<ConfigBlocksDirectiveByPlan> {
  return readByPlanMap(
    SETTING_KEYS.CONFIG_BLOCKS_DIRECTIVE_BY_PLAN,
    SETTING_KEYS.CONFIG_BLOCKS_DIRECTIVE,
    DEFAULT_CONFIG_BLOCKS_DIRECTIVE,
  );
}
export async function setConfigBlocksDirectiveByPlan(
  patch: Partial<ConfigBlocksDirectiveByPlan>,
): Promise<void> {
  const current = await getConfigBlocksDirectiveByPlan();
  await writeByPlanMap(
    SETTING_KEYS.CONFIG_BLOCKS_DIRECTIVE_BY_PLAN,
    current,
    patch,
  );
}

// Per-plan version du PROMPT_BLOCK_ORDER. Stocke un JSON map
// plan → BlockId[]. Lecture en cascade : map per-plan → singleton legacy
// → DEFAULT_PROMPT_BLOCK_ORDER. Toujours dédupliqué + tous IDs présents.
export type PromptBlockOrderByPlan = Record<PlanKey, BlockId[]>;

const sanitizeOrder = (order: unknown): BlockId[] => {
  if (!Array.isArray(order)) return [...DEFAULT_PROMPT_BLOCK_ORDER];
  const validSet = new Set<BlockId>(BLOCK_IDS);
  const seen = new Set<BlockId>();
  const result: BlockId[] = [];
  for (const x of order) {
    if (typeof x === "string" && validSet.has(x as BlockId) && !seen.has(x as BlockId)) {
      result.push(x as BlockId);
      seen.add(x as BlockId);
    }
  }
  for (const id of BLOCK_IDS) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
};

export async function getPromptBlockOrderByPlan(): Promise<PromptBlockOrderByPlan> {
  const [raw, legacyOrder] = await Promise.all([
    getSetting(SETTING_KEYS.PROMPT_BLOCK_ORDER_BY_PLAN),
    getPromptBlockOrder(),
  ]);
  const out = Object.fromEntries(
    PLANS.map((p) => [p.key, [...legacyOrder]]),
  ) as PromptBlockOrderByPlan;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<PlanKey, unknown>>;
      for (const p of PLANS) {
        const v = parsed[p.key];
        if (Array.isArray(v)) out[p.key] = sanitizeOrder(v);
      }
    } catch {
      // JSON corrompu → fallback legacy partout.
    }
  }
  return out;
}

export async function setPromptBlockOrderByPlan(
  patch: Partial<PromptBlockOrderByPlan>,
): Promise<void> {
  const current = await getPromptBlockOrderByPlan();
  const merged: PromptBlockOrderByPlan = { ...current };
  for (const p of PLANS) {
    const v = patch[p.key];
    if (Array.isArray(v)) merged[p.key] = sanitizeOrder(v);
  }
  await setSetting(
    SETTING_KEYS.PROMPT_BLOCK_ORDER_BY_PLAN,
    JSON.stringify(merged),
  );
}
