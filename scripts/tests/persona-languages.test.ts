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

console.log("ALL PERSONA-LANGUAGES TESTS PASSED");
