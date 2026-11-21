// Spoken languages (Persona P4): lib/persona/languages.ts. EMPTY list or the
// switch OFF = today's prompts, byte-identical. Mock data only.
// Run with:  npx tsx scripts/tests/persona-languages.test.ts

import assert from "node:assert/strict";

import { DEFAULT_PERSONA, LANGUAGES_TENANT_EDITABLE } from "../../lib/persona/contract";
import { inboundPersonaUpdates, outboundPersonaUpdates } from "../../lib/persona/store";
import {
  effectiveSpokenLanguages,
  inboundLanguageDirective,
  outboundLanguageBlock,
  withOutboundLanguages,
} from "../../lib/persona/languages";

// Today's receptionist directive, copied verbatim from /api/agent/config on main.
const TODAY = (label: string, code: string) => `LANGUE PAR DÉFAUT DU TENANT : ${label} (code: ${code}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- S'il/elle bascule à une autre langue, suis-le/la immédiatement.`;

// empty list = today, every primary language (and an unknown one, as today)
assert.equal(inboundLanguageDirective("fr", []), TODAY("français", "fr"));
assert.equal(inboundLanguageDirective("he", []), TODAY("hébreu", "he"));
assert.equal(inboundLanguageDirective("en", []), TODAY("anglais (US)", "en"));
assert.equal(inboundLanguageDirective("xx", []), TODAY("français", "xx"));
// a list that only repeats the primary = empty
assert.equal(inboundLanguageDirective("fr", ["fr"]), TODAY("français", "fr"));
// outbound: no block today
assert.equal(outboundLanguageBlock("fr", []), "");
assert.equal(withOutboundLanguages("Mock instructions", "fr", []), "Mock instructions");

// the stored list (P3) is what the prompts use
const stored = { ...DEFAULT_PERSONA, languages: ["he", "en"] };
assert.deepEqual(effectiveSpokenLanguages(stored), ["he", "en"]);
assert.deepEqual(effectiveSpokenLanguages(null), [], "never written → []");
assert.deepEqual(effectiveSpokenLanguages({ broken: true }), [], "invalid → []");
assert.deepEqual(effectiveSpokenLanguages(DEFAULT_PERSONA), [], "default persona → []");

// tenants can't set a non-empty list until the test call (admins can)
{
  assert.equal(LANGUAGES_TENANT_EDITABLE, false);
  const inRow = { agentName: "", primaryLanguage: "fr", greetingInstructions: "", aiDisclosureEnabled: true, aiDisclosureText: "", personaConfig: null };
  const outRow = { agentName: "Sarah", language: "fr", greeting: "", personaConfig: null };
  const set = { personaConfig: { languages: ["he"] } };
  for (const r of [inboundPersonaUpdates(set, inRow, false), outboundPersonaUpdates(set, outRow, false)]) {
    assert.ok(r && "error" in r);
    assert.deepEqual(r.error, { status: 403, body: { error: "admin_only", fields: ["languages"] } });
  }
  for (const r of [inboundPersonaUpdates(set, inRow, true), outboundPersonaUpdates(set, outRow, true)]) {
    assert.ok(r && !("error" in r) && r.persona.languages[0] === "he", "admins can");
  }
  // a tenant clearing the list, or saving other fields with an empty list, is fine
  assert.ok(!("error" in (inboundPersonaUpdates({ personaConfig: { languages: [] } }, inRow, false) ?? {})));
  assert.ok(!("error" in (inboundPersonaUpdates({ personaConfig: { name: "Tamara" } }, inRow, false) ?? {})));
}

// filled list: languages named, other languages fall back to the primary
{
  const d = inboundLanguageDirective("fr", ["he", "en"]);
  assert.match(d, /LANGUES PARLÉES : français \(fr\), hébreu \(he\), anglais \(US\) \(en\)/);
  assert.match(d, /réponds poliment en français/);
  assert.notEqual(d, TODAY("français", "fr"));
  const o = withOutboundLanguages("Mock instructions", "he", ["fr"]);
  assert.match(o, /^Mock instructions\n\nLANGUES PARLÉES : hébreu \(he\), français \(fr\)\. Commence en hébreu\./);
}

// outbound, one language that is not French: one written line (the campaign
// instructions are French, so without it an EN / HE call drifts to French)
{
  const MULTI_FR_EN = "LANGUES PARLÉES : français (fr), anglais (US) (en). Commence en français. Si la personne parle l'une de ces langues, poursuis dans la sienne ; sinon reste en français.";
  const MULTI_EN_FR = "LANGUES PARLÉES : anglais (US) (en), français (fr). Commence en anglais (US). Si la personne parle l'une de ces langues, poursuis dans la sienne ; sinon reste en anglais (US).";
  const EN_ONLY = "LANGUE PARLÉE : anglais (US) (en). Parle uniquement en anglais (US), du début à la fin de l'appel.";
  const HE_ONLY = "LANGUE PARLÉE : hébreu (he). Parle uniquement en hébreu, du début à la fin de l'appel.";
  // fr-only → "" (byte-identical to today)
  assert.equal(outboundLanguageBlock("fr", []), "");
  assert.equal(outboundLanguageBlock("fr", ["fr"]), "");
  // en-only / he-only → the line
  assert.equal(outboundLanguageBlock("en", []), EN_ONLY);
  assert.equal(outboundLanguageBlock("en", ["en"]), EN_ONLY);
  assert.equal(outboundLanguageBlock("he", []), HE_ONLY);
  assert.equal(withOutboundLanguages("Mock instructions", "he", []), `Mock instructions\n\n${HE_ONLY}`);
  // multi-language → today's block, unchanged
  assert.equal(outboundLanguageBlock("fr", ["en"]), MULTI_FR_EN);
  assert.equal(outboundLanguageBlock("en", ["fr"]), MULTI_EN_FR);
  assert.equal(outboundLanguageBlock("en", ["en", "fr"]), MULTI_EN_FR);
  // empty primary → French behaviour (no block); unknown code → no block
  assert.equal(outboundLanguageBlock("", []), "");
  assert.equal(withOutboundLanguages("Mock instructions", "", []), "Mock instructions");
  assert.equal(outboundLanguageBlock("xx", []), "");
  assert.equal(outboundLanguageBlock("toString", []), "");
}

console.log("ALL PERSONA-LANGUAGES TESTS PASSED");
