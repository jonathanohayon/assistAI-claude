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
- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- S'il/elle bascule à une autre langue, suis-le/la immédiatement.`;
};

export interface PromptBlock {
  id: string;
  label: string;
  /** UI source de vérité (texte court affiché dans l'en-tête du bloc). */
  source: string;
  /** Si présent, lien admin/dashboard pour éditer ce bloc. */
  editHref?: string;
  content: string;
  /**
   * Si présent, le bloc est éditable inline depuis la preview. Le client
   * envoie un PUT au bon endpoint avec le bon body field.
   * - scope=tenant : PUT /api/admin/configs/<userId> body[field] = newValue
   * - scope=plan   : PUT /api/admin/settings body[planField][planKey] = newValue
   *                  (le client doit lire la map courante avant — voir UI)
   */
  editable?:
    | { scope: "tenant"; field: string }
    | { scope: "plan"; planField: string; planKey: string };
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
  /** Bloc "capacités" DÉJÀ rendu (placeholders substitués selon les toggles
   *  du tenant). Affiché en fin de prompt, comme côté /api/agent/config. */
  capabilities: string;
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
    capabilities,
  } = opts;
  const primary = config.primaryLanguage ?? "fr";

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
      editable: {
        scope: "plan",
        planField: "spokenTimeDirectiveByPlan",
        planKey,
      },
    },
    spoken_phone: {
      id: "spoken_phone",
      label: "Prononciation des numéros",
      source: "app_settings.spoken_phone_directive",
      editHref: `/admin#directives`,
      content: spokenPhone,
      editable: {
        scope: "plan",
        planField: "spokenPhoneDirectiveByPlan",
        planKey,
      },
    },
    hangup: {
      id: "hangup",
      label: "Directive fin d'appel (end_call)",
      source: "app_settings.hangup_directive",
      editHref: `/admin#directives`,
      content: hangup,
      editable: {
        scope: "plan",
        planField: "hangupDirectiveByPlan",
        planKey,
      },
    },
    config_blocks: {
      id: "config_blocks",
      label: "Respect des étapes (config blocs)",
      source: "app_settings.config_blocks_directive",
      editHref: `/admin#directives`,
      content: configBlocks,
      editable: {
        scope: "plan",
        planField: "configBlocksDirectiveByPlan",
        planKey,
      },
    },
    persona: {
      id: "persona",
      label: "Persona tenant",
      source: "agent_configs.instructions",
      editHref: `#instructions-field`,
      content: config.instructions || "(vide)",
      editable: { scope: "tenant", field: "instructions" },
    },
    knowledge: {
      id: "knowledge",
      label: "Business — Identité, centres, soins",
      source: "agent_configs.business (jsonb structuré)",
      editHref: `#business-field`,
      content: (() => {
        // Préfère la nouvelle structure `business` si dispo + non-vide,
        // sinon fallback sur le legacy `knowledge` array.
        const b = (config as { business?: unknown }).business;
        if (
          b &&
          typeof b === "object" &&
          (((b as { identity?: { name?: string } }).identity?.name?.length ?? 0) > 0 ||
            ((b as { centres?: unknown[] }).centres?.length ?? 0) > 0 ||
            ((b as { services?: unknown[] }).services?.length ?? 0) > 0)
        ) {
          // Lazy require pour éviter cycle import — agent-prompt-preview est
          // pulled par server pages.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { renderBusinessPromptBlock, sanitizeBusinessConfig } = require(
            "@/lib/business",
          );
          return renderBusinessPromptBlock(sanitizeBusinessConfig(b));
        }
        const entries = Array.isArray(config.knowledge) ? config.knowledge : [];
        const filtered = entries.filter(
          (e) =>
            (e?.businessName?.length ?? 0) > 0 ||
            (e?.description?.length ?? 0) > 0,
        );
        if (filtered.length === 0) return "(vide — aucun business défini)";
        return filtered
          .map((e, i) => {
            const lines: string[] = [];
            lines.push(
              `### ${i + 1}. ${e.businessName || "(sans nom)"}${e.toolName ? ` [ref: ${e.toolName}]` : ""}`,
            );
            if (e.openingHours) lines.push(`Horaires : ${e.openingHours}`);
            if (e.description) lines.push(`Détails : ${e.description}`);
            return lines.join("\n");
          })
          .join("\n\n");
      })(),
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
      source: `app_settings.global_instructions_by_plan["${planKey}"] (wrapper "RÈGLES TRANSVERSES…" ajouté au runtime)`,
      editHref: `/admin#global-instructions`,
      // Affiche le contenu RAW (sans le wrapper « RÈGLES TRANSVERSES… »)
      // pour permettre l'édition inline directe — le wrapper est rajouté
      // côté worker au moment de l'assemblage.
      content: globalForPlan || "(vide pour ce plan)",
      editable: {
        scope: "plan",
        planField: "globalInstructionsByPlan",
        planKey,
      },
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
      source:
        "agent_configs.greeting_instructions (wrapper « Commence ta première réponse… » + fallback ajoutés au runtime côté worker, via generateReply en onEnter)",
      editHref: `#greeting-field`,
      // Affiche le contenu RAW (sans le wrapper) pour permettre l'édition
      // inline directe — sinon on sauvegarderait la version wrappée dans
      // greeting_instructions et on la double-wrapperait au prochain appel.
      // Même pattern que le bloc admin_global ci-dessus.
      content: config.greetingInstructions?.trim() || "(vide)",
      editable: { scope: "tenant", field: "greetingInstructions" },
    },
    ...orderedBlocks,
    {
      id: "capabilities",
      label: `${orderedBlocks.length + 2}. Capacités (RDV / CRM / Commandes)`,
      source:
        "app_settings.capabilities_directive_by_plan — placeholders {calendar}/{crm}/{orders} substitués selon les toggles des tuiles CRM du tenant. Édition du template dans /admin → Directives → Capacités.",
      editHref: `/admin#directives`,
      content: capabilities,
    },
    {
      id: "per_call_ctx",
      label: `${orderedBlocks.length + 3}. Template contexte par appel`,
      source: "app_settings.per_call_context_template",
      editHref: `/admin#directives`,
      content: perCallContextTemplate,
    },
  ];
}
