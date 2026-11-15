// The Persona tile's one-line summary: what the tenant has, in their words.
// "Sarah · Français" with a name, "Français" without. The language is named
// in the page's locale (DashboardConfig.personaTileLang*), never as a code.
// Built from the on-screen persona (the draft), like the other tiles.

import type { Persona } from "@/lib/persona/contract";

export const PERSONA_TILE_LANG_KEY = {
  fr: "personaTileLangFr",
  he: "personaTileLangHe",
  en: "personaTileLangEn",
} as const satisfies Record<Persona["primaryLanguage"], string>;

export const PERSONA_TILE_KEYS = ["personaTileSummary", ...Object.values(PERSONA_TILE_LANG_KEY)] as const;

type Translate = (key: (typeof PERSONA_TILE_KEYS)[number], values?: Record<string, string>) => string;

export function personaTileSummary(persona: Pick<Persona, "name" | "primaryLanguage">, t: Translate): string {
  const key = PERSONA_TILE_LANG_KEY[persona.primaryLanguage];
  const language = key ? t(key) : "—";
  const name = persona.name.trim();
  return name ? t("personaTileSummary", { name, language }) : language;
}
