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
import { publicWordRules, stripIcuArguments, wordHits } from "../tenant-words-match.mjs";

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

// --- The public namespaces -----------------------------------------------
// Every namespace read by components/marketing, components/plans and the
// public routes (home, sales, connect, login, signup, verify-email), plus
// HowItWorks (not rendered today, kept in step with the home's copy).
// Plans is shared word for word with /dashboard/billing.
const PUBLIC = [
  "CTA",
  "CurrencySwitcher",
  "FAQ",
  "Features",
  "Footer",
  "Hero",
  "HowItWorks",
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
  "PricingComparison",
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
assert.equal(at(fr, "Hero.stats.latency"), "Temps de réponse");
assert.equal(at(fr, "Features.list.crm.title"), "Fiche client remplie toute seule");
assert.equal(at(fr, "PricingComparison.rowCrm"), "Contacts dans Google Sheets");
assert.equal(at(fr, "Plans.global.features.2"), "Calendrier connecté & contacts");

console.log("public-words: ok");
