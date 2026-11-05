// AI disclosure in the greeting (lib/ai-disclosure.ts). Mock business names.
// Run with:  npx tsx scripts/tests/ai-disclosure.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  defaultDisclosureGreeting,
  effectiveGreeting,
  insertDisclosure,
  mentionsAi,
  parseDisclosureText,
} from "../../lib/ai-disclosure";
import { agentConfigs } from "../../lib/db/schema";
import { buildOpenerText } from "../../lib/opener";

const cfg = (over: Partial<Parameters<typeof effectiveGreeting>[0]> = {}) => ({
  greetingInstructions: "Bonjour, salon Mock ! Comment puis-je vous aider ?",
  agentName: "Tamara",
  primaryLanguage: "fr",
  aiDisclosureEnabled: true,
  aiDisclosureText: "",
  ...over,
});

// ON by default for every tenant
assert.equal(agentConfigs.aiDisclosureEnabled.default, true);
const sql = readFileSync(new URL("../../drizzle/0035_ai_disclosure.sql", import.meta.url), "utf8");
assert.match(sql, /"ai_disclosure_enabled" boolean DEFAULT true NOT NULL/);

// inserted after the first sentence, question stays last (hands the turn over)
assert.equal(
  effectiveGreeting(cfg(), "Salon Mock"),
  "Bonjour, salon Mock ! Je suis Tamara, une intelligence artificielle. Comment puis-je vous aider ?",
);
// single question → disclosure before it
assert.equal(
  insertDisclosure("Bonjour, comment puis-je vous aider ?", "Je suis Tamara, une intelligence artificielle."),
  "Je suis Tamara, une intelligence artificielle. Bonjour, comment puis-je vous aider ?",
);
// single statement → after it
assert.equal(insertDisclosure("Bienvenue chez Mock.", "X."), "Bienvenue chez Mock. X.");

// no tenant greeting → one-sentence default per language
assert.equal(
  effectiveGreeting(cfg({ greetingInstructions: "" }), "Salon Mock"),
  "Bonjour, vous êtes chez Salon Mock, je suis Tamara, une intelligence artificielle.",
);
assert.equal(
  defaultDisclosureGreeting("he", "תמרה", "סלון מוק"),
  "שלום, הגעתם לסלון מוק, כאן תמרה, בינה מלאכותית.",
);
assert.equal(
  defaultDisclosureGreeting("en", "", ""),
  "Hello, you're speaking with an AI assistant.",
);
// Hebrew greeting gets the Hebrew sentence
assert.equal(
  effectiveGreeting(cfg({ greetingInstructions: "שלום, סלון מוק! איך אפשר לעזור?", primaryLanguage: "he" }), ""),
  "שלום, סלון מוק! אני Tamara, בינה מלאכותית. איך אפשר לעזור?",
);

// already discloses → unchanged (no double disclosure)
const already = "Bonjour, je suis Tamara, l'assistante IA du salon Mock. Comment puis-je vous aider ?";
assert.equal(effectiveGreeting(cfg({ greetingInstructions: already }), ""), already);
// French "j'ai" is not "AI"
assert.equal(mentionsAi("Bonjour, j'ai une question"), false);
assert.equal(mentionsAi("כאן תמרה, בינה מלאכותית"), true);

// OFF → tenant greeting untouched, empty stays empty (model fallback as before)
assert.equal(effectiveGreeting(cfg({ aiDisclosureEnabled: false }), ""), cfg().greetingInstructions);
assert.equal(effectiveGreeting(cfg({ aiDisclosureEnabled: false, greetingInstructions: "" }), ""), "");

// custom line replaces the default sentence
assert.equal(
  effectiveGreeting(cfg({ aiDisclosureText: "Petite précision : je suis une IA." }), ""),
  "Bonjour, salon Mock ! Petite précision : je suis une IA. Comment puis-je vous aider ?",
);
// … and must itself say it's an AI
assert.deepEqual(parseDisclosureText("Je suis Tamara."), { ok: false, error: "ai_disclosure_must_mention_ai" });
assert.deepEqual(parseDisclosureText("  Je suis  une IA. "), { ok: true, value: "Je suis une IA." });
assert.deepEqual(parseDisclosureText(""), { ok: true, value: "" });
assert.deepEqual(parseDisclosureText(42), { ok: false, error: "invalid_ai_disclosure_text" });
assert.equal(parseDisclosureText("IA ".repeat(80)).ok, false);

// the pre-rendered opener and the model greeting use the same text
const spoken = effectiveGreeting(cfg(), "Salon Mock");
assert.equal(buildOpenerText(spoken, "fr"), spoken); // ends with "?" → nothing appended
assert.equal(
  buildOpenerText(effectiveGreeting(cfg({ greetingInstructions: "" }), "Salon Mock"), "fr"),
  "Bonjour, vous êtes chez Salon Mock, je suis Tamara, une intelligence artificielle. Comment puis-je vous aider ?",
);

console.log("ALL AI-DISCLOSURE TESTS PASSED");
