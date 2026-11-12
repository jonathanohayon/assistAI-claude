// The public home demo's one fictional place, and the fact sheet the demo
// prompt gets about it (POST /api/session with demo:true or anonymous,
// lib/demo-instructions.ts).
//
// The home demo is public: whatever business facts reach its prompt can be
// spoken to any visitor. So the demo never renders a stored account's
// `business` block (centres, centresRules, services, hours, prices): those
// facts come only from this file, the same fictional place the canned demo
// tools answer with (lib/demo-tools.ts imports it from here). No real
// business, street or town. Open days follow the page's language: fr/en
// Monday to Friday, he Sunday to Thursday, Saturday always closed. Free slots
// around 10:00 / 11:30 / 15:00, closing at 18:00. Prices are fictional, in the
// currency the landing's Pricing section shows for the locale
// (lib/landing-currency.ts landingCurrencyFor).
//
// PURE: no DB, no logger. scripts/tests/demo-place.test.ts covers it.

import { CURRENCY_META, landingCurrencyFor, type Currency } from "@/lib/landing-currency";

export const DEMO_LANGS = ["fr", "en", "he"] as const;
export type DemoLang = (typeof DEMO_LANGS)[number];

/** A language the demo knows, else French (the demo's default). */
export const demoLang = (v: unknown): DemoLang =>
  typeof v === "string" && (DEMO_LANGS as readonly string[]).includes(v) ? (v as DemoLang) : "fr";

/** Open weekdays per language (0 = Sunday). */
export const DEMO_OPEN_DAYS: Readonly<Record<DemoLang, readonly number[]>> = {
  fr: [1, 2, 3, 4, 5],
  en: [1, 2, 3, 4, 5],
  he: [0, 1, 2, 3, 4],
};

/** The demo's one fictional place. The Hebrew wording is still to confirm. */
export const DEMO_PLACE_ID = "demo_salon";
export const DEMO_PLACE: Readonly<Record<DemoLang, string>> = {
  fr: "notre salon du centre-ville",
  en: "our downtown salon",
  he: "הסלון שלנו במרכז העיר", // [HE] to confirm
};

/** Canned free starts on an open day (HH:MM, Asia/Jerusalem). */
export const DEMO_SLOTS = ["10:00", "11:30", "15:00"] as const;
export const DEMO_OPEN_TIME = "10:00";
export const DEMO_CLOSE_TIME = "18:00";

export interface DemoService {
  name: Readonly<Record<DemoLang, string>>;
  durationMinutes: number;
  /** Fictional price per currency; the page's currency picks one. */
  price: Readonly<Record<Currency, number>>;
}

/** Fictional services. Every one fits between the last slot (15:00) and closing. */
export const DEMO_SERVICES: readonly DemoService[] = [
  {
    name: { fr: "Coupe et brushing", en: "Haircut and blow-dry", he: "תספורת ופן" },
    durationMinutes: 45,
    price: { ILS: 180, USD: 50, EUR: 45 },
  },
  {
    name: { fr: "Brushing", en: "Blow-dry", he: "פן" },
    durationMinutes: 30,
    price: { ILS: 100, USD: 30, EUR: 25 },
  },
  {
    name: { fr: "Couleur", en: "Hair color", he: "צבע לשיער" },
    durationMinutes: 90,
    price: { ILS: 320, USD: 80, EUR: 70 },
  },
  {
    name: { fr: "Manucure", en: "Manicure", he: "מניקור" },
    durationMinutes: 30,
    price: { ILS: 120, USD: 35, EUR: 30 },
  },
];

/** The currency of the demo's prices for a language: the landing's for that locale. */
export const demoCurrency = (lang: unknown): Currency => landingCurrencyFor(demoLang(lang));

const DAY_NAMES_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
/** Display order of the week per language: the visitor's week starts on Monday (fr/en) or Sunday (he). */
const WEEK_ORDER: Readonly<Record<DemoLang, readonly number[]>> = {
  fr: [1, 2, 3, 4, 5, 6, 0],
  en: [1, 2, 3, 4, 5, 6, 0],
  he: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * The demo's fact sheet, for the prompt. Framing in French like the rest of
 * the demo prompt; the place and service names in the page's language, so the
 * agent says them as the canned tools do.
 */
export function demoSheetBlock(lang: unknown): string {
  const l = demoLang(lang);
  const currency = demoCurrency(l);
  const symbol = CURRENCY_META[currency].symbol;
  const open = new Set(DEMO_OPEN_DAYS[l]);
  const hours = WEEK_ORDER[l]
    .map((d) => `  - ${DAY_NAMES_FR[d]} : ${open.has(d) ? `${DEMO_OPEN_TIME}–${DEMO_CLOSE_TIME}` : "fermé"}`)
    .join("\n");
  const services = DEMO_SERVICES.map(
    (s) => `  - ${s.name[l]} : ${s.durationMinutes} min, ${s.price[currency]} ${symbol}`,
  ).join("\n");
  return [
    "LIEU DE LA DÉMO (fictif, la seule source sur le lieu) :",
    `- Un seul lieu : « ${DEMO_PLACE[l]} ». Appelle-le toujours ainsi, sans adresse ni nom de ville.`,
    `- Horaires :\n${hours}`,
    `- Prestations et tarifs :\n${services}`,
    `- Créneaux : appelle \`check_availability\` pour la date demandée ; ne propose que les créneaux qu'il renvoie.`,
  ].join("\n");
}
