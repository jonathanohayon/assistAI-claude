// Construit le TEXTE de l'opener pré-généré (accueil prononcé à l'ouverture
// d'appel) et son hash de cache. Pur : pas d'I/O, testable unitairement.
//
// Règle : si le greeting du tenant n'invite pas à parler (ne finit pas par
// "?"), on append une question d'ouverture localisée — c'est ce que le modèle
// faisait déjà après le greeting verbatim, donc zéro régression de comportement.

import { createHash } from "node:crypto";

export const DEFAULT_OPENING_QUESTION: Record<"fr" | "he" | "en", string> = {
  fr: "Comment puis-je vous aider ?",
  he: "איך אפשר לעזור?",
  en: "How can I help you?",
};

function localeKey(locale: string): "fr" | "he" | "en" {
  return locale === "he" ? "he" : locale === "en" ? "en" : "fr";
}

/**
 * Texte de l'opener prononcé à l'accueil. Greeting vide → "" (pas de
 * pré-render, fallback modèle).
 */
export function buildOpenerText(greeting: string, locale: string): string {
  const g = (greeting ?? "").trim();
  if (!g) return "";
  // "Invite à parler" = se termine (hors guillemets/parenthèses/espaces) par "?".
  const stripped = g.replace(/["'»)\s]+$/u, "");
  if (stripped.endsWith("?")) return g;
  return `${g} ${DEFAULT_OPENING_QUESTION[localeKey(locale)]}`;
}

/** Hash stable du texte d'opener — clé de cache. */
export function openerHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}
