// Internal words a tenant must not read on their screens (design decision of
// 15/11, internal-words audit sections A and B): tenants read plain words,
// e.g. "Personnalité" not "Persona", "votre tableau Google" not "le Sheet".
// Used by scripts/check-tenant-words.mjs (rendered tenant pages) and
// scripts/tests/tenant-words.test.ts (L1 message namespaces). Pure.
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
  return [...COMMON, ["Sheet", sheet], ...(locale === "he" ? HEBREW : [])];
}

/** Removes the product name "Google Sheets" so the Sheet rule ignores it. */
const withoutProductName = (text) => text.replace(/\bGoogle Sheets\b/g, "Google ·");

/**
 * Removes ICU argument names from a message ("{token} est remplacé",
 * "{pstn, plural, …}"): they are placeholders, never shown.
 */
export const stripIcuArguments = (message) => message.replace(/\{\s*[A-Za-z_]\w*\s*(?=[,}])/g, "{");

/** Map word -> up to 3 short contexts where it occurs in `text`. */
export function wordHits(text, locale) {
  const t = withoutProductName(text);
  const out = new Map();
  for (const [label, re] of wordRules(locale)) {
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
