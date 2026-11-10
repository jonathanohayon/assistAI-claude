// Spoken languages (Persona P4): lib/persona/languages.ts. EMPTY list or the
// switch OFF = today's prompts, byte-identical. Mock data only.
// Run with:  npx tsx scripts/tests/persona-languages.test.ts

import assert from "node:assert/strict";

import { DEFAULT_PERSONA } from "../../lib/persona/contract";
import {
  effectiveSpokenLanguages,
  inboundLanguageDirective,
  outboundLanguageBlock,
  spokenLanguagesEnabled,
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

// switch: off by default; a stored list is ignored while off
assert.equal(spokenLanguagesEnabled({}), false);
assert.equal(spokenLanguagesEnabled({ PERSONA_LANGUAGES: "yes" }), false);
assert.equal(spokenLanguagesEnabled({ PERSONA_LANGUAGES: " ON " }), true);
const stored = { ...DEFAULT_PERSONA, languages: ["he", "en"] };
assert.deepEqual(effectiveSpokenLanguages(stored, false), [], "switch off → []");
assert.deepEqual(effectiveSpokenLanguages(stored, true), ["he", "en"]);
assert.deepEqual(effectiveSpokenLanguages(null, true), [], "never written → []");
assert.deepEqual(effectiveSpokenLanguages({ broken: true }, true), [], "invalid → []");

// filled list (switch on): languages named, other languages fall back to the primary
{
  const d = inboundLanguageDirective("fr", ["he", "en"]);
  assert.match(d, /LANGUES PARLÉES : français \(fr\), hébreu \(he\), anglais \(US\) \(en\)/);
  assert.match(d, /réponds poliment en français/);
  assert.notEqual(d, TODAY("français", "fr"));
  const o = withOutboundLanguages("Mock instructions", "he", ["fr"]);
  assert.match(o, /^Mock instructions\n\nLANGUES PARLÉES : hébreu \(he\), français \(fr\)\. Commence en hébreu\./);
}

console.log("ALL PERSONA-LANGUAGES TESTS PASSED");
