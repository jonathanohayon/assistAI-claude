// Internal words a tenant must not read on their screens (design decision of
// 15/11, internal-words audit sections A and B): tenants read plain words,
// e.g. "Personnalité" not "Persona", "votre tableau Google" not "le Sheet".
// Used by scripts/check-tenant-words.mjs (rendered tenant AND public pages)
// and scripts/tests/tenant-words.test.ts (message namespaces). Pure.
//
// Whole words only. Case-insensitive except where a lowercase form is a
// legitimate word:
//   - "Live Test" (capital T, the English product-ish label) and "LiveTest";
//     "Live test" is the decided English copy.
//   - "Sheet": in English, a lowercase "sheet" is ordinary copy ("company
//     sheet", "lead sheet": a fact sheet), so only a capitalised "Sheet" is
//     matched there. French and Hebrew have no such word: any case matches.
//     "Google Sheets" (the product's name) is allowed everywhere.
// Hebrew: the transliterations of the same words.
//
// Both rule sets (tenant and public) also carry the first customer's names,
// in every locale: scripts/first-customer-names.mjs.

import { FIRST_CUSTOMER_NAME_RULES } from "./first-customer-names.mjs";

const COMMON = [
  ["Persona", /\bpersonas?\b/gi],
  ["PSTN", /\bPSTN\b/gi],
  ["CRM", /\bCRM\b/gi],
  ["Live Test", /\bLive Test\b/g],
  ["LiveTest", /\bLiveTest\b/gi],
  ["OAuth", /\bOAuth\b/gi],
  ["token", /\btokens?\b/gi],
  ["tenant", /\btenants?\b/gi],
];
const HEBREW = [
  ["Persona", /פרסונ/g],
  ["token", /טוקן/g],
  ["tenant", /טננט/g],
];
const SHEET_ANY_CASE = /\bsheets?\b/gi;
const SHEET_CAPITAL = /\bSheets?\b/g;

/** The rules for one locale: [label, regex] pairs (global regexes). */
export function wordRules(locale) {
  const sheet = locale === "en" ? SHEET_CAPITAL : SHEET_ANY_CASE;
  return [...COMMON, ["Sheet", sheet], ...(locale === "he" ? HEBREW : []), ...FIRST_CUSTOMER_NAME_RULES];
}

// Supplier voice names (Voice brick rule: a voice is shown as the dashboard
// shows it, "Voix 1 · féminine", never by its supplier's name). The home's
// voice-studio mock showed "Coral" until 16/11.
// Sources (this file is plain .mjs, so the lists are copied; the public words
// test checks they still match):
//   - OpenAI realtime ids: lib/voice/public.ts VOICE_IDS;
//   - Gemini and Grok names: lib/voice/catalogue.ts GEMINI / GROK.
export const OPENAI_VOICE_IDS = [
  "marin", "cedar", "ballad", "sage", "verse", "alloy", "shimmer",
  "echo", "fable", "onyx", "nova", "coral", "ash",
];
export const GEMINI_VOICE_NAMES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe",
  "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore",
  "Laomedeia", "Leda", "Orus", "Pulcherrima", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager",
  "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
];
// Grok voices, minus the ones that are common first names or ordinary words
// in our locales (a mock contact or a sentence would trip them): eve, leo,
// luna, iris, aurora, atlas, orion, rex, sal, lux, lumen, castor (FR
// "beaver"), celeste, zenith, helix, cosmo, ara, carina, liora.
export const GROK_VOICE_NAMES = [
  "altair", "helios", "kepler", "naksh", "perseus", "rigel", "sirius", "ursa", "zagan",
];
// OpenAI ids that are ordinary words in a locale: there, only the capitalised
// voice name matches ("Sage", not "un conseil sage"; "Coral", not "coral
// reef"). A sentence that starts with one still matches: rephrase it.
// Hebrew copy has none of them as words: any case matches.
export const ORDINARY_VOICE_WORDS = {
  fr: ["sage", "marin", "verse", "fable", "onyx", "nova"],
  en: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "cedar", "fable", "onyx", "nova"],
  he: [],
};
const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{M}\\p{N}_])";
const capitalise = (w) => w[0].toUpperCase() + w.slice(1);

/** Whole-word rules for the supplier voice names, for one locale. */
export function voiceNameRules(locale) {
  // An unknown locale gets the union: the strictest case rule for each id.
  const ordinary = new Set(ORDINARY_VOICE_WORDS[locale] ?? Object.values(ORDINARY_VOICE_WORDS).flat());
  const anyCase = OPENAI_VOICE_IDS.filter((id) => !ordinary.has(id));
  const capitalised = [
    ...OPENAI_VOICE_IDS.filter((id) => ordinary.has(id)).map(capitalise),
    ...GEMINI_VOICE_NAMES,
    ...GROK_VOICE_NAMES.map(capitalise),
  ];
  const word = (names, flags) => new RegExp(`${NOT_LETTER_BEFORE}(?:${names.join("|")})${NOT_LETTER_AFTER}`, flags);
  return [
    // Never an empty alternation: it would match everywhere.
    ...(anyCase.length ? [["supplier voice name", word(anyCase, "giu")]] : []),
    ["supplier voice name", word(capitalised, "gu")],
  ];
}

/**
 * The rules for the PUBLIC pages (home, landings, login, signup; audit
 * section D): what a prospect reads first. Persona, CRM, Sheet (same
 * per-locale case rule as above), the latency jargon the hero used
 * ("Latence vocale", now "Temps de réponse") and the supplier voice names.
 */
export function publicWordRules(locale) {
  const sheet = locale === "en" ? SHEET_CAPITAL : SHEET_ANY_CASE;
  const latency = {
    fr: ["Latence", /\blatences?\b/gi],
    en: ["Latency", /\blatency\b/gi],
    he: ["Latency", /השהי/g],
  }[locale] ?? ["Latency", /\blaten(?:ce|cy)s?\b/gi];
  return [
    ["Persona", /\bpersonas?\b/gi],
    ["CRM", /\bCRM\b/gi],
    ["Sheet", sheet],
    latency,
    ...(locale === "he" ? [["Persona", /פרסונ/g]] : []),
    ...voiceNameRules(locale),
    ...FIRST_CUSTOMER_NAME_RULES,
  ];
}

/**
 * Removes the product name "Google Sheets" so the Sheet rule ignores it, in
 * any case: the home's logo strip writes it in capitals ("GOOGLE SHEETS").
 */
const withoutProductName = (text) => text.replace(/\bGoogle Sheets\b/gi, "Google ·");

/**
 * Removes ICU argument names from a message ("{token} est remplacé",
 * "{pstn, plural, …}"): they are placeholders, never shown.
 */
export const stripIcuArguments = (message) => message.replace(/\{\s*[A-Za-z_]\w*\s*(?=[,}])/g, "{");

/**
 * Removes e-mail addresses: they are the tenant's own data, not copy (the
 * mock tenant is tenant@example.test, a real one may be anything).
 */
export const withoutEmails = (text) => text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]");

/**
 * Map word -> up to 3 short contexts where it occurs in `text`. `rules`
 * defaults to the tenant rules; pass publicWordRules(locale) for public pages.
 */
export function wordHits(text, locale, rules = wordRules(locale)) {
  const t = withoutProductName(withoutEmails(text));
  const out = new Map();
  for (const [label, re] of rules) {
    for (const m of t.matchAll(re)) {
      const ctx = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, " ");
      const list = out.get(label) ?? [];
      if (list.length < 3) list.push(ctx);
      out.set(label, list);
    }
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? all;
  });

/**
 * What a person can read on a server-rendered page: text nodes plus the
 * attributes a browser shows (title, aria-label, placeholder, alt, value of
 * buttons/inputs). Scripts (the RSC payload carries every client message,
 * admin ones included), styles and templates are dropped.
 */
export function visibleText(html) {
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const attrs = [...body.matchAll(/\s(?:title|aria-label|placeholder|alt|value)="([^"]*)"/gi)].map((m) => m[1]);
  const text = body.replace(/<[^>]*>/g, " ");
  return decode([text, ...attrs].join(" ")).replace(/\s+/g, " ");
}
