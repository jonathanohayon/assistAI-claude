// Plain words on the PUBLIC pages (internal-words audit, section D): the
// message namespaces the home, the landings, login and signup read carry no
// "Persona", "CRM", "Sheet" (outside "Google Sheets") or latency jargon, in
// fr/en/he, and neither do the landings' six modules. The fast half of the
// guard; the rendered half is the public pass of scripts/check-tenant-words.mjs.
// Run with:  npx tsx scripts/tests/public-words.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sixModules } from "../../lib/marketing/landings/modules";
import { createTranslator } from "next-intl";

import { VOICE_CATALOGUE } from "../../lib/voice/catalogue";
import { VOICE_IDS } from "../../lib/voice/public";
import {
  GEMINI_VOICE_NAMES,
  GROK_VOICE_NAMES,
  OPENAI_VOICE_IDS,
  publicWordRules,
  stripIcuArguments,
  wordHits,
} from "../tenant-words-match.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
type Messages = Record<string, unknown>;
const messages = (l: string): Messages => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
const found = (text: string, locale = "fr") =>
  [...(wordHits(text, locale, publicWordRules(locale)) as Map<string, string[]>).keys()];

// --- The public rules ----------------------------------------------------
assert.deepEqual(found("Latence vocale"), ["Latence"]);
assert.deepEqual(found("Voice latency", "en"), ["Latency"]);
assert.deepEqual(found("השהיה קולית", "he"), ["Latency"]);
assert.deepEqual(found("Temps de réponse"), [], "the decided word");
assert.deepEqual(found("Configurez votre persona"), ["Persona"]);
assert.deepEqual(found("Choisissez la personnalité"), []);
assert.deepEqual(found("הגדירו את הפרסונה", "he"), ["Persona"]);
assert.deepEqual(found("CRM auto-rempli"), ["CRM"]);
assert.deepEqual(found("dans votre Sheet"), ["Sheet"]);
assert.deepEqual(found("dans votre tableau Google Sheets"), []);
assert.deepEqual(found("GOOGLE CALENDAR GOOGLE SHEETS GMAIL"), [], "the logo strip's capitals are the product name");
assert.deepEqual(found("Aucun Google Sheet"), ["Sheet"], "only the product name, plural, is allowed");
assert.deepEqual(found("Instructions OAuth du tenant"), [], "tenant-only words are not public rules");

// --- Supplier voice names ------------------------------------------------
const VOICE = "supplier voice name";
assert.deepEqual(found("Coral · Femme"), [VOICE], "the old home mock");
assert.deepEqual(found("Coral · Female", "en"), [VOICE]);
assert.deepEqual(found("Coral · אישה", "he"), [VOICE]);
assert.deepEqual(found("voix coral, voix marin"), [VOICE], "FR: coral is no French word");
assert.deepEqual(found("un marin sage verse une fable"), [], "FR ordinary words, lowercase");
assert.deepEqual(found("a coral reef, an ash tree, the echo of a ballad", "en"), [], "EN ordinary words, lowercase");
assert.deepEqual(found("Bossa nova"), [], "nova is a word in FR and EN");
assert.deepEqual(found("Choose Sage or Echo", "en"), [VOICE], "the capitalised voice name");
assert.deepEqual(found("sage", "he"), [VOICE], "Hebrew copy: any case");
assert.deepEqual(found("l'écho de votre voix"), [], "whole words: écho is not echo");
assert.deepEqual(found("Kore, Puck"), [VOICE]);
assert.deepEqual(found("a hockey puck", "en"), [], "Gemini names: capitalised only");
assert.deepEqual(found("Kepler"), [VOICE]);
assert.deepEqual(found("Eve, Leo, Luna", "en"), [], "first names left out of the Grok list");
for (const l of LOCALES) {
  assert.deepEqual(found("Voix 1 · féminine Voice 1 · female קול 1 · נשי", l), [], `${l}: the dashboard's voice label`);
}
// The copied lists still match their sources.
assert.deepEqual([...OPENAI_VOICE_IDS].sort(), [...VOICE_IDS].sort(), "OPENAI_VOICE_IDS = lib/voice/public.ts VOICE_IDS");
const catalogueNames = new Set(VOICE_CATALOGUE.filter((v) => v.engine !== "openai").map((v) => v.name));
for (const n of [...GEMINI_VOICE_NAMES, ...GROK_VOICE_NAMES]) assert.ok(catalogueNames.has(n), `${n} is in lib/voice/catalogue.ts`);
assert.equal(
  GEMINI_VOICE_NAMES.length,
  VOICE_CATALOGUE.filter((v) => v.engine === "gemini").length,
  "every Gemini voice is listed",
);

// --- The public namespaces -----------------------------------------------
// Every namespace read by components/marketing, components/plans and the
// public routes (home, sales, connect, login, signup, verify-email).
// Plans is shared word for word with /dashboard/billing.
const PUBLIC = [
  "CTA",
  "CurrencySwitcher",
  "FAQ",
  "Features",
  "Footer",
  "Hero",
  "Industries",
  "Integrations",
  "LocaleSwitcher",
  "Login",
  "Metadata",
  "Nav",
  "OutboundCalling",
  "Performance",
  "Plans",
  "Pricing",
  "Security",
  "Signup",
  "SocialProof",
  "Support",
  "TwoMinutes",
  "VerifyEmail",
  "VoiceDemo",
  "VoiceStudio",
];

function* strings(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === "string") yield [path, node];
  else if (Array.isArray(node)) for (const [i, v] of node.entries()) yield* strings(v, `${path}.${i}`);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) yield* strings(v, `${path}.${k}`);
}
const at = (m: Messages, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], m);

const problems: string[] = [];
for (const l of LOCALES) {
  const m = messages(l);
  for (const ns of PUBLIC) {
    assert.ok(m[ns], `${l}: namespace ${ns} exists`);
    for (const [key, value] of strings(m[ns], ns)) {
      const h = found(stripIcuArguments(value), l);
      if (h.length) problems.push(`${l} ${key}: ${h.join(", ")} in "${value}"`);
    }
  }
  const modules = sixModules(l);
  for (const item of modules.items) {
    const h = [...found(item.title, l), ...found(item.body, l)];
    if (h.length) problems.push(`${l} six modules "${item.id}": ${h.join(", ")}`);
  }
}
assert.deepEqual(problems, [], `internal words in public copy:\n${problems.join("\n")}`);

// The decided wording itself (FR), so a revert shows up by name.
const fr = messages("fr");
assert.equal(at(fr, "Features.list.crm.title"), "Fiche client remplie automatiquement");
assert.equal(at(fr, "Plans.global.features.2"), "Calendrier connecté & contacts");

// The home's voice-studio mock says what the dashboard says: its voice label
// is the dashboard's Voice 1, female (Voices.display), its language label the
// Agent brick's "Langue par défaut" (PersonaBrick.languageLabel).
for (const l of LOCALES) {
  const m = messages(l);
  const t = createTranslator({ locale: l, messages: m as never, namespace: "Voices" as never }) as unknown as (
    key: string,
    values: Record<string, string | number>,
  ) => string;
  const shown = `${at(m, "VoiceStudio.panel.voiceName")} · ${at(m, "VoiceStudio.panel.voiceGenderF")}`;
  assert.equal(shown, t("display", { n: 1, gender: "f" }), `${l}: mock voice label`);
  assert.equal(at(m, "VoiceStudio.panel.defaultLanguage"), at(m, "PersonaBrick.languageLabel"), `${l}: mock language label`);
}

console.log("public-words: ok");
