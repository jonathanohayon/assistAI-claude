// The first customer's business name and its receptionist persona's name:
// shared copy must never show them to a tenant or a visitor (decision of
// 15/11). Shared copy uses the demo's fictional place (lib/demo-place.ts) or
// neutral wording. Kept in its own module so the words rules
// (tenant-words-match.mjs) only spread it in. Pure.
//
// What matches, in every locale and in any case:
//   - the business name "Prestige", with or without an accent ("Prestigé",
//     precomposed or combining), as a whole word: "Prestige's" matches,
//     "prestigieux" / "prestigious" do not. NOTE: the ordinary noun
//     ("le prestige") matches too; shared copy has no use for it today;
//   - Hebrew: פרסטיז / פרסטיג, with or without a geresh (', ׳, ’), with or
//     without a prefix letter (מפרסטיז׳, בפרסטיג');
//   - the persona: Johana / Johanna / Yohana / Yohanna as a whole word, and
//     Hebrew יוחנה / יוהנה / ג'והנה / ג׳והנה. "Johannesburg" and the Hebrew
//     name יוחנן do not match.

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{M}\\p{N}_])";

export const FIRST_CUSTOMER_NAME_RULES = [
  ["first customer's name", new RegExp(`${NOT_LETTER_BEFORE}prestig(?:e\\u0301|[eé])${NOT_LETTER_AFTER}`, "giu")],
  ["first customer's name", /פרסטי[זג]/g],
  ["first customer's persona", new RegExp(`${NOT_LETTER_BEFORE}[jy]ohann?a${NOT_LETTER_AFTER}`, "giu")],
  ["first customer's persona", /יוחנה|יוהנה|ג['׳’]?והנה/g],
];
