// The "six modules" section, shared by every landing page. One plain line
// per module, true today on every agent:
//   - Channels says "the phone" only: WhatsApp voice waits on Meta's opt-in
//     (lib/channels/contract.ts: shown only once Meta allows it), and
//     outbound dialing is PSTN only.
//   - Tools stays generic: no outbound booking or transfer promise.

import type { ModulesCopy, ModuleId } from "@/lib/marketing/home-content";

import type { LandingLocale, Localized } from "./switches";

const HEADING: { kicker: Localized; title: Localized; subtitle: Localized } = {
  kicker: { fr: "Six modules", en: "Six modules", he: "שישה מודולים" },
  title: { fr: "Un agent, six réglages.", en: "One agent, six settings.", he: "סוכן אחד, שש הגדרות." },
  subtitle: {
    fr: "Chaque agent Tamara est fait des mêmes six modules.",
    en: "Every Tamara agent is made of the same six modules.",
    he: "כל סוכן של תמרה בנוי מאותם שישה מודולים.",
  },
};

const MODULES: readonly { id: ModuleId; title: Localized; body: Localized }[] = [
  {
    id: "voice",
    title: { fr: "Voix", en: "Voice", he: "קול" },
    body: { fr: "Une voix et un débit, au choix.", en: "Pick a voice and a pace.", he: "בוחרים קול וקצב דיבור." },
  },
  {
    id: "persona",
    title: { fr: "Personnage", en: "Persona", he: "דמות" },
    body: { fr: "Son prénom, son ton, ses langues.", en: "Its name, its tone, its languages.", he: "שם, טון ושפות." },
  },
  {
    id: "knowledge",
    title: { fr: "Savoir", en: "Knowledge", he: "ידע" },
    body: { fr: "Votre site et vos documents.", en: "Your website and your documents.", he: "האתר והמסמכים שלכם." },
  },
  {
    id: "tools",
    title: { fr: "Outils", en: "Tools", he: "כלים" },
    body: {
      fr: "Ce que l'agent a le droit de faire pendant l'appel.",
      en: "What the agent is allowed to do during the call.",
      he: "מה שהסוכן רשאי לעשות במהלך השיחה.",
    },
  },
  {
    id: "channels",
    title: { fr: "Canaux", en: "Channels", he: "ערוצים" },
    body: { fr: "Le téléphone.", en: "The phone.", he: "הטלפון." },
  },
  {
    id: "mission",
    title: { fr: "Mission", en: "Mission", he: "משימה" },
    body: { fr: "Ce que l'appel doit obtenir.", en: "What the call must achieve.", he: "מה שהשיחה צריכה להשיג." },
  },
];

export function sixModules(l: LandingLocale): ModulesCopy {
  return {
    kicker: HEADING.kicker[l],
    title: HEADING.title[l],
    subtitle: HEADING.subtitle[l],
    items: MODULES.map((m) => ({ id: m.id, title: m.title[l], body: m.body[l] })),
  };
}
