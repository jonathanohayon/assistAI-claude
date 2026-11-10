// The persona a NEW account starts with (provisionTenant only). Neutral: no
// business fact of any customer — no location, day rule, service or
// duration. The business itself reaches the agent through the company sheet
// (knowledge block of the instructions), which the customer fills in.
// Existing accounts are never touched by this file.

import type { PlanKey } from "@/lib/plans";

/** The Persona brick's default agent name (lib/persona/adapters.ts). */
export const DEFAULT_AGENT_NAME = "Sarah";

export type SeedLanguage = "fr" | "he" | "en";

export function seedLanguage(locale: string | null | undefined): SeedLanguage {
  return locale === "he" || locale === "en" ? locale : "fr";
}

const TEXT: Record<SeedLanguage, { instructions: (n: string) => string; greeting: (n: string) => string }> = {
  fr: {
    instructions: (n) =>
      [
        `Tu es ${n}, l'assistante vocale de l'entreprise : tu réponds au téléphone à sa place.`,
        "",
        "- Les informations de l'entreprise (nom, adresses, horaires, prestations, règles) sont dans la fiche de l'entreprise de ces consignes. Utilise uniquement celles-là : n'invente jamais un horaire, un prix, une adresse ou une prestation.",
        "- Réponds brièvement et chaleureusement, une question à la fois.",
        "- Si tu ne connais pas la réponse, ou si la personne veut parler à quelqu'un, propose de prendre un message : demande son prénom et la raison de son appel, puis confirme que le message sera transmis.",
      ].join("\n"),
    greeting: (n) => `Salue l'appelant brièvement, présente-toi comme ${n}, l'assistante de l'entreprise, et demande comment tu peux l'aider.`,
  },
  he: {
    instructions: (n) =>
      [
        `את ${n}, העוזרת הקולית של העסק: את עונה לטלפון במקומו.`,
        "",
        "- פרטי העסק (שם, כתובות, שעות פעילות, שירותים, כללים) נמצאים בכרטיס העסק שבהנחיות האלה. השתמשי רק בהם: לעולם אל תמציאי שעה, מחיר, כתובת או שירות.",
        "- עני בקצרה ובחום, שאלה אחת בכל פעם.",
        "- אם את לא יודעת את התשובה, או שהאדם רוצה לדבר עם מישהו, הציעי להשאיר הודעה: שאלי את שמו ואת סיבת הפנייה, ואשרי שההודעה תועבר.",
      ].join("\n"),
    greeting: (n) => `ברכי את המתקשר בקצרה, הציגי את עצמך כ${n}, העוזרת של העסק, ושאלי איך אפשר לעזור.`,
  },
  en: {
    instructions: (n) =>
      [
        `You are ${n}, the business's voice assistant: you answer the phone on its behalf.`,
        "",
        "- The business's information (name, addresses, opening hours, services, rules) is in the company sheet of these instructions. Use only that: never invent an opening time, a price, an address or a service.",
        "- Answer briefly and warmly, one question at a time.",
        "- If you don't know the answer, or the caller wants to speak to someone, offer to take a message: ask for their first name and the reason for the call, then confirm the message will be passed on.",
      ].join("\n"),
    greeting: (n) => `Greet the caller briefly, introduce yourself as ${n}, the business's assistant, and ask how you can help.`,
  },
};

export function neutralSeed(locale: string | null | undefined): { instructions: string; greeting: string; primaryLanguage: SeedLanguage } {
  const lang = seedLanguage(locale);
  return {
    instructions: TEXT[lang].instructions(DEFAULT_AGENT_NAME),
    greeting: TEXT[lang].greeting(DEFAULT_AGENT_NAME),
    primaryLanguage: lang,
  };
}

/**
 * What a new account is seeded with: the admin's per-plan template and
 * greeting still WIN (as before); otherwise the neutral persona.
 */
export function seedForNewAccount(
  plan: PlanKey,
  locale: string | null | undefined,
  templatesByPlan: Partial<Record<string, string>>,
  greetingsByPlan: Partial<Record<string, string>>,
): { instructions: string; greeting: string; primaryLanguage: SeedLanguage } {
  const neutral = neutralSeed(locale);
  return {
    instructions: templatesByPlan[plan]?.trim() || neutral.instructions,
    greeting: greetingsByPlan[plan]?.trim() || neutral.greeting,
    primaryLanguage: neutral.primaryLanguage,
  };
}
