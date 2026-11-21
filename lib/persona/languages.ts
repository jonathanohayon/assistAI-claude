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

/**
 * The language the Voice brick's lock ("Rester dans la langue principale")
 * pins the receptionist to, or null when the lock is off. Mirrors the worker
 * (src/voice-profile.ts `language()`), which writes "Always answer in X" from
 * the served voiceProfile: languageHint when it isn't "auto", else the
 * tenant's primaryLanguage (|| "fr").
 */
export function lockedLanguage(
  voice: { languageLock: boolean; languageHint: string },
  primaryLanguage: string | null | undefined,
): string | null {
  if (!voice.languageLock) return null;
  return voice.languageHint !== "auto" ? voice.languageHint : primaryLanguage || "fr";
}

/** Lock on: ONE language rule (the worker's "Always answer in X" agrees with it). */
function lockedInbound(primary: string, locked: string): string {
  return `LANGUE PAR DÉFAUT DU TENANT : ${LABEL[primary as PersonaLanguage] ?? "français"} (code: ${primary}).
- Utilise cette langue pour le tout premier message d'accueil.
- LANGUE VERROUILLÉE : réponds TOUJOURS en ${LABEL[locked as PersonaLanguage] ?? locked} (code: ${locked}), même si ton interlocuteur parle une autre langue ou en change.`;
}

/**
 * Receptionist language block. Empty list → today's text exactly.
 * `locked` (lockedLanguage()) non-null → the lock text, whatever the list:
 * the "answer in the caller's language" rules would contradict the lock.
 * Omitted / null → byte-identical to before the lock was read here.
 */
export function inboundLanguageDirective(
  primary: string,
  languages: readonly PersonaLanguage[],
  locked: string | null = null,
): string {
  if (locked) return lockedInbound(primary, locked);
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
