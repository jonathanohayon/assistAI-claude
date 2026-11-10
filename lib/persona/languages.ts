// Spoken languages (Persona P4): the agent may switch, among a list, when the
// caller does. Pure. The language rules live in the prompts the web builds,
// so this is a web-only change.
//
// EMPTY list (the default) = today's prompts, byte-identical (tested).
// A filled list only takes effect when the server switch PERSONA_LANGUAGES is
// "on" — off by default until a test call validates it.

import { parsePersona, type PersonaLanguage } from "@/lib/persona/contract";

const LABEL: Record<PersonaLanguage, string> = { fr: "français", he: "hébreu", en: "anglais (US)" };

export function spokenLanguagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PERSONA_LANGUAGES ?? "").trim().toLowerCase() === "on";
}

/** The list stored in personaConfig (none / invalid → []), only when the switch is on. */
export function effectiveSpokenLanguages(personaConfig: unknown, enabled = spokenLanguagesEnabled()): PersonaLanguage[] {
  if (!enabled) return [];
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

/** Outbound language block, appended to the campaign instructions. Empty list → "" (today: none). */
export function outboundLanguageBlock(primary: string, languages: readonly PersonaLanguage[]): string {
  const others = languages.filter((l) => l !== primary);
  if (!others.length) return "";
  const allowed = [primary, ...others].map((l) => `${LABEL[l as PersonaLanguage] ?? l} (${l})`).join(", ");
  return `LANGUES PARLÉES : ${allowed}. Commence en ${LABEL[primary as PersonaLanguage] ?? primary}. Si la personne parle l'une de ces langues, poursuis dans la sienne ; sinon reste en ${LABEL[primary as PersonaLanguage] ?? primary}.`;
}

/** Instructions + the outbound block (unchanged when the block is empty). */
export function withOutboundLanguages(instructions: string, primary: string, languages: readonly PersonaLanguage[]): string {
  const block = outboundLanguageBlock(primary, languages);
  return block ? `${instructions}\n\n${block}` : instructions;
}
