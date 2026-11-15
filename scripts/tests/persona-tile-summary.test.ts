// Persona tile summary: the agent's name and default language, named in the
// page's locale ("Sarah · Français", or "Français" without a name). No
// internal wording (admin inheritance) and no language codes. Mock data only.
// Run with:  npx tsx scripts/tests/persona-tile-summary.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "next-intl";

import {
  PERSONA_TILE_KEYS,
  personaTileSummary,
} from "../../app/[locale]/dashboard/config/persona-tile-summary";
import { PERSONA_LANGUAGES } from "../../lib/persona/contract";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LOCALES = ["fr", "en", "he"] as const;
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`)) as Record<string, Record<string, string>>;

function summaryFor(locale: string, persona: { name: string; primaryLanguage: (typeof PERSONA_LANGUAGES)[number] }) {
  const t = createTranslator({ locale, messages: messages(locale), namespace: "DashboardConfig" });
  return personaTileSummary(persona, (key, values) => t(key, values));
}

const EXPECTED: Record<(typeof LOCALES)[number], Record<(typeof PERSONA_LANGUAGES)[number], string>> = {
  fr: { fr: "Français", he: "Hébreu", en: "Anglais" },
  en: { fr: "French", he: "Hebrew", en: "English" },
  he: { fr: "צרפתית", he: "עברית", en: "אנגלית" },
};

// 1. Name + language.
assert.equal(summaryFor("fr", { name: "Sarah", primaryLanguage: "fr" }), "Sarah · Français", "fr: name and language");
assert.equal(summaryFor("en", { name: "Sarah", primaryLanguage: "he" }), "Sarah · Hebrew", "en: name and language");
assert.equal(summaryFor("he", { name: "Sarah", primaryLanguage: "en" }), "Sarah · אנגלית", "he: name and language");

// 2. Language only: empty or blank name.
assert.equal(summaryFor("fr", { name: "", primaryLanguage: "fr" }), "Français", "fr: no name shows the language only");
assert.equal(summaryFor("fr", { name: "   ", primaryLanguage: "fr" }), "Français", "fr: a blank name counts as no name");
assert.equal(summaryFor("en", { name: "", primaryLanguage: "en" }), "English", "en: no name shows the language only");

// 3. Locale display names, never codes, for every language in every locale.
for (const locale of LOCALES) {
  for (const lang of PERSONA_LANGUAGES) {
    const s = summaryFor(locale, { name: "", primaryLanguage: lang });
    assert.equal(s, EXPECTED[locale][lang], `${locale}/${lang}: display name in the page's locale`);
    assert.doesNotMatch(s, /\b(FR|HE|EN)\b/, `${locale}/${lang}: no language code`);
  }
}

// 4. No admin-inheritance wording reaches a tenant: not in any summary, not in
// the tile's source, and the old keys are gone from every locale.
const INHERIT = /hérit|inherit|יורש/i;
for (const locale of LOCALES) {
  for (const lang of PERSONA_LANGUAGES) {
    for (const name of ["", "Sarah"]) {
      assert.doesNotMatch(summaryFor(locale, { name, primaryLanguage: lang }), INHERIT, `${locale}/${lang}: no inherit wording`);
    }
  }
  const dc = messages(locale).DashboardConfig;
  assert.equal(dc.wowPersonaSummaryInherit, undefined, `${locale}: old inherit summary key removed`);
  assert.equal(dc.wowPersonaSummaryCustom, undefined, `${locale}: old custom summary key removed`);
}
const form = read("app/[locale]/dashboard/config-form.tsx");
const personaTile = form.slice(form.indexOf('id: "persona"'), form.indexOf('id: "notifs"'));
assert.match(personaTile, /summary: personaTileSummary\(persona, t\)/, "the tile uses the helper on the draft persona");
assert.doesNotMatch(personaTile, /inheritAdminGlobals/, "the tile summary never reads the inheritance flag");

// 5. The same keys in every locale.
for (const locale of LOCALES) {
  const dc = messages(locale).DashboardConfig;
  for (const key of PERSONA_TILE_KEYS) {
    assert.equal(typeof dc[key], "string", `${locale}: ${key} present`);
    assert.ok(dc[key].trim().length > 0, `${locale}: ${key} not empty`);
  }
}

console.log("persona-tile-summary: all assertions passed");
