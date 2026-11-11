// Persona brick languages copy: the default-language label, the other-languages
// label and the one line under the field, in fr/en/he. The line must quote the
// Voice brick's language-lock switch label word for word. Wording only.
// Run with:  npx tsx scripts/tests/persona-languages-copy.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
type Messages = { PersonaBrick: Record<string, string>; VoiceBrick: Record<string, string> };
const load = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8")) as Messages;

const EXPECTED = {
  fr: {
    languageLabel: "Langue par défaut",
    languagesLabel: "Autres langues parlées",
    languageHint: "L'agent répond dans la langue de l'appelant, sauf si « Rester dans la langue principale » est activé.",
  },
  en: {
    languageLabel: "Default language",
    languagesLabel: "Other languages spoken",
    languageHint: "The agent answers in the caller's language, unless “Stay in the main language” is on.",
  },
  he: {
    languageLabel: "שפת ברירת מחדל",
    languagesLabel: "שפות נוספות שהסוכן מדבר",
    languageHint: "הסוכן עונה בשפה של המתקשר, אלא אם האפשרות ״להישאר בשפה הראשית״ מופעלת.",
  },
} as const;

const KEYS = ["languageLabel", "languagesLabel", "languageHint"] as const;

for (const [locale, want] of Object.entries(EXPECTED)) {
  const m = load(locale);
  // 1. the three strings
  for (const k of KEYS) assert.equal(m.PersonaBrick[k], want[k], `${locale} PersonaBrick.${k}`);
  // 2. the line quotes the language-lock switch's exact label
  const lock = m.VoiceBrick.languageLockLabel;
  assert.ok(lock && lock.length > 0, `${locale} VoiceBrick.languageLockLabel exists`);
  assert.ok(m.PersonaBrick.languageHint.includes(lock), `${locale} hint quotes "${lock}" verbatim`);
}

// 3. same keys in all three locales (PersonaBrick namespace)
{
  const [fr, en, he] = ["fr", "en", "he"].map((l) => Object.keys(load(l).PersonaBrick).sort());
  assert.deepEqual(en, fr, "en PersonaBrick keys = fr");
  assert.deepEqual(he, fr, "he PersonaBrick keys = fr");
}

// 4. the component renders the line under the main-language field
{
  const src = readFileSync(join(ROOT, "components/bricks/persona/PersonaBrick.tsx"), "utf8");
  assert.match(src, /t\("languageHint"\)/, "PersonaBrick renders languageHint");
  assert.ok(src.indexOf('t("languageLabel")') < src.indexOf('t("languageHint")'), "hint sits after the label");
}

console.log("ALL PERSONA-LANGUAGES-COPY TESTS PASSED");
