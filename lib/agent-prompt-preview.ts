// Assemble une PREVIEW exacte du system prompt qui sera envoyé à l'agent
// OpenAI Realtime pour un tenant donné. Sert au panneau /admin/users/[userId]
// "Prompt complet envoyé à l'agent" pour que l'admin voie d'un coup d'œil :
//   - quel bloc vient d'où
//   - lesquels sont éditables et depuis quelle UI
//
// Tout est maintenant éditable depuis /admin (singletons pour les
// directives système, per-plan pour le admin block et les seeds), donc
// pas de drift code-vs-affichage à craindre — on lit les MÊMES strings
// que celles injectées dans /api/agent/config.

import type { BlockId } from "@/lib/agent-prompt-defaults";
import type { AgentConfig } from "@/lib/db/schema";

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais (US)",
};

const buildLanguageDirective = (primary: string): string => {
  const label = LANG_LABEL[primary] ?? "français";
  return `LANGUE PAR DÉFAUT DU TENANT : ${label} (code: ${primary}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que la cliente parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- Si elle bascule à une autre langue, suis-la immédiatement.`;
};

const buildAdminBlock = (globalForPlan: string): string => {
  if (!globalForPlan.trim()) return "";
  return `RÈGLES TRANSVERSES ADDITIONNELLES (à appliquer EN COMPLÉMENT du persona ci-dessus, jamais à sa place) :\n\n${globalForPlan}`;
};

export interface PromptBlock {
  id: string;
  label: string;
  /** UI source de vérité (texte court affiché dans l'en-tête du bloc). */
  source: string;
  /** Si présent, lien admin/dashboard pour éditer ce bloc. */
  editHref?: string;
  content: string;
}

/**
 * Renvoie la séquence complète des blocs assemblés dans le system prompt
 * envoyé à OpenAI Realtime pour un tenant. L'ordre suit ce que fait
 * /api/agent/config (= ce qu'OpenAI reçoit).
 */
export function buildAgentPromptPreview(opts: {
  config: AgentConfig;
  globalForPlan: string;
  planKey: string;
  spokenTime: string;
  spokenPhone: string;
  hangup: string;
  perCallContextTemplate: string;
  configBlocks: string;
  blockOrder: BlockId[];
}): PromptBlock[] {
  const {
    config,
    globalForPlan,
    planKey,
    spokenTime,
    spokenPhone,
    hangup,
    perCallContextTemplate,
    configBlocks,
    blockOrder,
  } = opts;
  const primary = config.primaryLanguage ?? "fr";

  // Le greeting est utilisé séparément en generateReply({instructions})
  // dans onEnter, pas dans le system prompt. On le montre quand même en
  // tête de liste comme c'est le 1er truc que la cliente entend.
  const wrappedGreeting = config.greetingInstructions?.trim()
    ? `Commence ta première réponse en prononçant TEXTUELLEMENT, mot pour mot et dans la même langue, la phrase d'accueil ci-dessous. Ne reformule pas, ne paraphrase pas. PUIS, dans la même réponse vocale, enchaîne directement avec la PREMIÈRE étape de ton persona/workflow — par exemple poser la question d'ouverture si ton persona l'exige.

Phrase d'accueil littérale :
"""
${config.greetingInstructions}
"""`
    : `(fallback) Salue chaleureusement la cliente en te présentant : utilise ton prénom et le nom du centre tels que définis dans tes instructions système. Enchaîne immédiatement avec la première question/étape de ton persona.`;

  // Map ID → bloc. L'ordre d'apparition dans la preview suit blockOrder
  // (= ce qui est réellement injecté dans le system prompt). Greeting +
  // per_call_context sont hors de cet ordre (le greeting est per-turn,
  // le per_call_context est un message chatCtx). On les épingle aux
  // extrémités pour la lisibilité.
  const byId: Record<BlockId, PromptBlock> = {
    spoken_time: {
      id: "spoken_time",
      label: "Prononciation des heures",
      source: "app_settings.spoken_time_directive",
      editHref: `/admin#directives`,
      content: spokenTime,
    },
    spoken_phone: {
      id: "spoken_phone",
      label: "Prononciation des numéros",
      source: "app_settings.spoken_phone_directive",
      editHref: `/admin#directives`,
      content: spokenPhone,
    },
    hangup: {
      id: "hangup",
      label: "Directive fin d'appel (end_call)",
      source: "app_settings.hangup_directive",
      editHref: `/admin#directives`,
      content: hangup,
    },
    config_blocks: {
      id: "config_blocks",
      label: "Respect des étapes (config blocs)",
      source: "app_settings.config_blocks_directive",
      editHref: `/admin#directives`,
      content: configBlocks,
    },
    persona: {
      id: "persona",
      label: "Persona tenant",
      source: "agent_configs.instructions",
      editHref: `#instructions-field`,
      content: config.instructions || "(vide)",
    },
    language: {
      id: "language",
      label: "Directive langue",
      source: `Calculé depuis agent_configs.primary_language = "${primary}"`,
      editHref: `#language-field`,
      content: buildLanguageDirective(primary),
    },
    admin_global: {
      id: "admin_global",
      label: `Règles transverses admin (plan: ${planKey})`,
      source: `app_settings.global_instructions_by_plan["${planKey}"]`,
      editHref: `/admin#global-instructions`,
      content: buildAdminBlock(globalForPlan) || "(vide pour ce plan)",
    },
  };

  const orderedBlocks = blockOrder
    .map((id, i) => {
      const b = byId[id];
      return b ? { ...b, label: `${i + 2}. ${b.label}` } : null;
    })
    .filter((b): b is PromptBlock => b !== null);

  return [
    {
      id: "greeting",
      label: "1. Phrase d'accueil (greeting)",
      source: "agent_configs.greeting_instructions",
      editHref: `#greeting-field`,
      content: wrappedGreeting,
    },
    ...orderedBlocks,
    {
      id: "per_call_ctx",
      label: `${orderedBlocks.length + 2}. Template contexte par appel`,
      source: "app_settings.per_call_context_template",
      editHref: `/admin#directives`,
      content: perCallContextTemplate,
    },
  ];
}
