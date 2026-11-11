// Spoken languages (Persona P4): the agent may switch, among a list, when the
// caller does. Pure. The language rules live in the prompts the web builds,
// so this is a web-only change.
//
// EMPTY list (the default) = today's prompts, byte-identical (tested).
// Until Jonathan's test call in a second language, only admins can set a
// list (LANGUAGES_TENANT_EDITABLE in lib/persona/contract.ts, enforced on
// write in lib/persona/store.ts).

import { parsePersona, type PersonaLanguage } from "@/lib/persona/contract";

const LABEL: Record<PersonaLanguage, string> = { fr: "français", he: "hébreu", en: "anglais (US)" };

/** The list stored in personaConfig (never written / invalid → []). */
export function effectiveSpokenLanguages(personaConfig: unknown): PersonaLanguage[] {
  const p = parsePersona(personaConfig);
  return p.ok ? p.value.languages : [];
}

/** Today's receptionist directive, verbatim (moved from /api/agent/config). */
function todayInbound(primary: string): string {
  return `LANGUE PAR DÉFAUT DU TENANT : ${LABEL[primary as PersonaLanguage] ?? "français"} (code: ${primary}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- S'il/elle bascule à une autre langue, suis-le/la immédiatement.`;
}

/** Receptionist language block. Empty list → today's text exactly. */
export function inboundLanguageDirective(primary: string, languages: readonly PersonaLanguage[]): string {
  const others = languages.filter((l) => l !== primary);
  if (!others.length) return todayInbound(primary);
  const allowed = [primary, ...others].map((l) => `${LABEL[l as PersonaLanguage] ?? l} (${l})`).join(", ");
  return `LANGUE PAR DÉFAUT DU TENANT : ${LABEL[primary as PersonaLanguage] ?? "français"} (code: ${primary}).
- Utilise cette langue pour le tout premier message d'accueil.
- LANGUES PARLÉES : ${allowed}. Si ton interlocuteur parle l'une d'elles, réponds STRICTEMENT dans la sienne et suis-le/la s'il/elle bascule entre elles.
- S'il/elle parle une autre langue, réponds poliment en ${LABEL[primary as PersonaLanguage] ?? primary}.`;
}

/**
 * Outbound language block, appended to the campaign instructions (which are
 * written in French).
 * - French only (or an empty / unknown primary): "" (today: none).
 * - One language that is not French: the same block, reduced to one line —
 *   otherwise nothing written tells an EN or HE campaign not to speak French.
 * - Several languages: the full block (unchanged).
 */
export function outboundLanguageBlock(primary: string, languages: readonly PersonaLanguage[]): string {
  const others = languages.filter((l) => l !== primary);
  if (!others.length) {
    const label = primary !== "fr" && Object.hasOwn(LABEL, primary) ? LABEL[primary as PersonaLanguage] : undefined;
    return label ? `LANGUE PARLÉE : ${label} (${primary}). Parle uniquement en ${label}, du début à la fin de l'appel.` : "";
  }
  const allowed = [primary, ...others].map((l) => `${LABEL[l as PersonaLanguage] ?? l} (${l})`).join(", ");
  return `LANGUES PARLÉES : ${allowed}. Commence en ${LABEL[primary as PersonaLanguage] ?? primary}. Si la personne parle l'une de ces langues, poursuis dans la sienne ; sinon reste en ${LABEL[primary as PersonaLanguage] ?? primary}.`;
}

/** Instructions + the outbound block (unchanged when the block is empty, i.e. French only). */
export function withOutboundLanguages(instructions: string, primary: string, languages: readonly PersonaLanguage[]): string {
  const block = outboundLanguageBlock(primary, languages);
  return block ? `${instructions}\n\n${block}` : instructions;
}
