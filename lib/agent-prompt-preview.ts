// Assemble une PREVIEW exacte du system prompt qui sera envoyé à l'agent
// OpenAI Realtime pour un tenant donné. Sert au panneau /admin/users/[userId]
// "Prompt complet envoyé à l'agent" pour que l'admin voie d'un coup d'œil :
//   - quel bloc vient d'où
//   - lesquels sont éditables et depuis quelle UI
//   - lesquels sont hardcodés dans le worker (immutable depuis le web)
//
// ⚠️ Les blocs WORKER_* sont des COPIES de ce qui vit dans
// ~/Desktop/assistAI-claude-agent/agent.ts. Doivent rester synchronisés
// manuellement quand on modifie l'un ou l'autre. Comme ces blocs changent
// rarement (directives hardcoded comportement agent), le drift est gérable
// — mais c'est un point d'attention.

import type { AgentConfig } from "@/lib/db/schema";

// ── 1. SPOKEN_TIME_DIRECTIVE (worker hardcoded) ─────────────────────────
const WORKER_SPOKEN_TIME = `
──────────────────────────────────────────
**PRONONCIATION DES HEURES — IMPORTANT**
Quand tu lis une heure à VOIX HAUTE à la cliente, formate-la naturellement. NE LIS JAMAIS le format \`HH:MM\` littéral, ça donne "zéro neuf zéro zéro" — c'est moche.

En français :
- \`09:00\` → "neuf heures" (ou "neuf heures du matin" si ambigu)
- \`09:30\` → "neuf heures et demie" ou "neuf heures trente"
- \`10:15\` → "dix heures et quart"
- \`11:45\` → "midi moins le quart"
- \`12:00\` → "midi"
- \`12:30\` → "midi et demi"
- \`13:00\` → "treize heures" ou "une heure de l'après-midi"
- \`18:00\` → "six heures du soir" ou "dix-huit heures"

En hébreu :
- \`09:00\` → "תשע בבוקר"
- \`09:30\` → "תשע וחצי"
- \`12:00\` → "שתים-עשרה בצהריים"
- \`18:00\` → "שש בערב"

Quand tu PASSES une heure à un tool (\`book_appointment\`, etc.), garde le format \`HH:MM\` dans les arguments — c'est uniquement la prononciation orale qui change.
──────────────────────────────────────────`;

// ── 2. SPOKEN_PHONE_DIRECTIVE (worker hardcoded) ────────────────────────
const WORKER_SPOKEN_PHONE = `
──────────────────────────────────────────
**PRONONCIATION DES NUMÉROS DE TÉLÉPHONE — IMPORTANT**
Quand tu lis un numéro de téléphone à VOIX HAUTE :
1. JAMAIS l'indicatif international (\`+972\`, \`+33\`, etc.) — utilise toujours le format local israélien (commence par \`0\`).
2. Lis CHIFFRE PAR CHIFFRE, jamais comme un grand nombre. \`0585001007\` se lit "zéro, cinq, huit, cinq, zéro, zéro, un, zéro, zéro, sept" — PAS "cinq cent quatre-vingt-cinq mille…".
3. Groupe par paires pour la fluidité : \`05 85 00 10 07\` → "zéro cinq, huit cinq, zéro zéro, un zéro, zéro sept" avec une micro-pause entre chaque paire.

En hébreu, même logique : chiffre par chiffre, groupé par paires.
- \`0585001007\` → "אפס חמש, שמונה חמש, אפס אפס, אחת אפס, אפס שבע"

En anglais : "zero five, eight five, zero zero, one zero, zero seven".

Cette règle s'applique à TOUS les numéros que tu énonces — celui qui appelle, celui qu'une cliente te dicte pour confirmation, etc.
──────────────────────────────────────────`;

// ── 3. HANGUP_DIRECTIVE (worker hardcoded) ──────────────────────────────
const WORKER_HANGUP = `
──────────────────────────────────────────
**RÈGLE DE FIN D'APPEL — OBLIGATOIRE**
Quand la conversation est CLAIREMENT terminée — la cliente a dit "au revoir / merci / à bientôt / shalom", OU le RDV est pris et elle n'a plus rien à ajouter, OU elle a raccroché verbalement — tu DOIS :

1. Dire ta phrase de clôture chaleureuse **UNE SEULE FOIS** (ex. "Au revoir, à très vite !" ou avec le prénom de la cliente uniquement si elle te l'a donné dans la conversation)
2. **Immédiatement** après, appeler le tool \`end_call\` avec un argument \`reason\` court (\`rdv_pris\`, \`rdv_annulé\`, \`info_donnée\`, \`client_raccroche\`, etc.)
3. **APRÈS l'appel à end_call : NE PRODUIRE AUCUNE NOUVELLE RÉPONSE VOCALE.** Le tool result ne doit déclencher aucun "au revoir" supplémentaire ni aucune phrase de courtoisie. La ligne se ferme, tout son émis sera coupé. Reste silencieux.

Ne JAMAIS attendre que la cliente raccroche elle-même — c'est ton rôle de clôturer la ligne. Si tu oublies d'appeler end_call, la cliente reste connectée pour rien et continue de payer la communication.

Ne PAS appeler end_call en plein milieu d'un échange ou sur la moindre pause.
──────────────────────────────────────────`;

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

// Per-call dynamic context — injecté en chatCtx au début de chaque appel.
// Inclus dans la preview à titre informatif (les valeurs réelles changent
// à chaque appel : la date est celle d'aujourd'hui, le caller phone n'est
// connu qu'à la connexion SIP).
const buildPerCallContextPreview = (): string => {
  const now = new Date();
  const dateFr = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `──────────────────────────────────────────
**CONTEXTE TEMPOREL (Asia/Jerusalem)**
- Aujourd'hui : ${dateFr} (\`${isoDate}\`)
- Heure locale : ${time}
- Fuseau de référence : Asia/Jerusalem (toutes les dates et heures que tu manipules sont dans ce fuseau)

Quand la cliente dit "demain", "lundi prochain", "dans 2 semaines", etc. → calcule la date YYYY-MM-DD à partir d'aujourd'hui ci-dessus AVANT d'appeler un tool. Ne demande JAMAIS la date complète à la cliente, ce serait étrange ("c'est quel jour aujourd'hui ?").
──────────────────────────────────────────

──────────────────────────────────────────
**NUMÉRO DU CLIENT (détecté via l'appel)**
[Injecté dynamiquement au début de chaque appel via TenantAgent.onEnter — contient le numéro local converti depuis E.164 + une directive de confirmation avant usage dans les tools. Vide pour les appels sans caller-id.]
──────────────────────────────────────────`;
};

export interface PromptBlock {
  id: string;
  label: string;
  /** UI source de vérité (texte court affiché dans l'en-tête du bloc). */
  source: string;
  /** Si présent, lien admin/dashboard pour éditer ce bloc. */
  editHref?: string;
  content: string;
  /** Block hardcodé dans le code agent.ts du worker. Non éditable depuis l'UI. */
  workerHardcoded?: boolean;
}

/**
 * Renvoie la séquence complète des blocs assemblés dans le system prompt
 * envoyé à OpenAI Realtime pour un tenant. L'ordre suit ce que fait
 * réellement le worker dans agent.ts (STATIC_INSTRUCTIONS + chatCtx system
 * messages).
 */
export function buildAgentPromptPreview(opts: {
  config: AgentConfig;
  globalForPlan: string;
  planKey: string;
}): PromptBlock[] {
  const { config, globalForPlan, planKey } = opts;
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

  return [
    {
      id: "greeting",
      label: "1. Phrase d'accueil (greeting)",
      source: "agent_configs.greeting_instructions",
      editHref: `#greeting-field`,
      content: wrappedGreeting,
    },
    {
      id: "spoken-time",
      label: "2. Directive prononciation des heures",
      source: "agent.ts (worker, SPOKEN_TIME_DIRECTIVE)",
      workerHardcoded: true,
      content: WORKER_SPOKEN_TIME,
    },
    {
      id: "spoken-phone",
      label: "3. Directive prononciation des numéros",
      source: "agent.ts (worker, SPOKEN_PHONE_DIRECTIVE)",
      workerHardcoded: true,
      content: WORKER_SPOKEN_PHONE,
    },
    {
      id: "hangup",
      label: "4. Directive fin d'appel (end_call)",
      source: "agent.ts (worker, HANGUP_DIRECTIVE)",
      workerHardcoded: true,
      content: WORKER_HANGUP,
    },
    {
      id: "persona",
      label: "5. Persona tenant",
      source: "agent_configs.instructions",
      editHref: `#instructions-field`,
      content: config.instructions || "(vide)",
    },
    {
      id: "language",
      label: "6. Directive langue",
      source: `Calculé depuis agent_configs.primary_language = "${primary}"`,
      editHref: `#language-field`,
      content: buildLanguageDirective(primary),
    },
    {
      id: "admin-global",
      label: `7. Règles transverses admin (plan: ${planKey})`,
      source: `app_settings.global_instructions_by_plan["${planKey}"]`,
      editHref: `/admin#global-instructions`,
      content: buildAdminBlock(globalForPlan) || "(vide pour ce plan)",
    },
    {
      id: "per-call-ctx",
      label: "8. Contexte par appel (date + caller phone)",
      source: "agent.ts (worker, PER_CALL_CONTEXT injecté en chatCtx au call start)",
      workerHardcoded: true,
      content: buildPerCallContextPreview(),
    },
  ];
}
