// Defaults pour les directives système éditables depuis /admin. Ces strings
// étaient historiquement hardcodées dans agent.ts du worker repo
// (~/Desktop/assistAI-claude-agent/). On les a sorties pour permettre à
// l'admin de les éditer sans toucher au code worker. Elles vivent maintenant
// dans app_settings (table key/value), avec ces constantes comme fallback
// quand la clé n'a jamais été éditée.
//
// ⚠️ PER_CALL_CONTEXT_TEMPLATE contient des placeholders runtime :
//   {date_fr}    — date locale Jerusalem formatée fr-FR (ex. "lundi 13 mai 2026")
//   {iso_date}   — date YYYY-MM-DD (ex. "2026-05-13")
//   {time}       — heure HH:MM Jerusalem
//   {caller_phone}  — numéro local du caller (vide si non détecté)
// Le worker fait la substitution avant injection. Garder le naming aligné
// avec agent.ts/buildPerCallContext (cherche `{date_fr}` etc).

export const DEFAULT_SPOKEN_TIME_DIRECTIVE = `
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

export const DEFAULT_SPOKEN_PHONE_DIRECTIVE = `
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

export const DEFAULT_HANGUP_DIRECTIVE = `
──────────────────────────────────────────
**RÈGLE DE FIN D'APPEL — OBLIGATOIRE**
Quand la conversation est CLAIREMENT terminée — la cliente a dit "au revoir / merci / à bientôt / shalom", OU le RDV est pris et elle n'a plus rien à ajouter, OU elle a raccroché verbalement — tu DOIS :

1. Dire ta phrase de clôture chaleureuse **UNE SEULE FOIS** (ex. "Au revoir, à très vite !" ou avec le prénom de la cliente uniquement si elle te l'a donné dans la conversation)
2. **Immédiatement** après, appeler le tool \`end_call\` avec un argument \`reason\` court (\`rdv_pris\`, \`rdv_annulé\`, \`info_donnée\`, \`client_raccroche\`, etc.)
3. **APRÈS l'appel à end_call : NE PRODUIRE AUCUNE NOUVELLE RÉPONSE VOCALE.** Le tool result ne doit déclencher aucun "au revoir" supplémentaire ni aucune phrase de courtoisie. La ligne se ferme, tout son émis sera coupé. Reste silencieux.

Ne JAMAIS attendre que la cliente raccroche elle-même — c'est ton rôle de clôturer la ligne. Si tu oublies d'appeler end_call, la cliente reste connectée pour rien et continue de payer la communication.

Ne PAS appeler end_call en plein milieu d'un échange ou sur la moindre pause.
──────────────────────────────────────────`;

export const DEFAULT_PER_CALL_CONTEXT_TEMPLATE = `
──────────────────────────────────────────
**CONTEXTE TEMPOREL (Asia/Jerusalem)**
- Aujourd'hui : {date_fr} (\`{iso_date}\`)
- Heure locale : {time}
- Fuseau de référence : Asia/Jerusalem (toutes les dates et heures que tu manipules sont dans ce fuseau)

Quand la cliente dit "demain", "lundi prochain", "dans 2 semaines", etc. → calcule la date YYYY-MM-DD à partir d'aujourd'hui ci-dessus AVANT d'appeler un tool. Ne demande JAMAIS la date complète à la cliente, ce serait étrange ("c'est quel jour aujourd'hui ?").
──────────────────────────────────────────

──────────────────────────────────────────
**NUMÉRO DU CLIENT (détecté via l'appel)**
{caller_hint_block}
──────────────────────────────────────────`;
