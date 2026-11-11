// Voice lock ("Rester dans la langue principale") vs the receptionist's
// language directive (lib/persona/languages.ts). Lock OFF = byte-identical to
// main; lock ON = ONE rule, the language the worker's "Always answer in X"
// line names (languageHint unless "auto", else primaryLanguage). Mock only.
// Run with:  npx tsx scripts/tests/inbound-language-lock.test.ts

import assert from "node:assert/strict";

import { BLOCK_SEPARATOR, inboundSessionInstructions } from "../../lib/agent/session-instructions";
import type { PersonaLanguage } from "../../lib/persona/contract";
import { inboundLanguageDirective, lockedLanguage } from "../../lib/persona/languages";
import { DEFAULT_VOICE_PROFILE } from "../../lib/voice-profile";

// inboundLanguageDirective(primary, languages) as produced by origin/main
// (003246e), key = "primary|languages".
const MAIN: Record<string, string> = {
 "fr|": "LANGUE PAR DÉFAUT DU TENANT : français (code: fr).\n- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.\n- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.\n- S'il/elle bascule à une autre langue, suis-le/la immédiatement.",
 "he|": "LANGUE PAR DÉFAUT DU TENANT : hébreu (code: he).\n- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.\n- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.\n- S'il/elle bascule à une autre langue, suis-le/la immédiatement.",
 "en|": "LANGUE PAR DÉFAUT DU TENANT : anglais (US) (code: en).\n- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.\n- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.\n- S'il/elle bascule à une autre langue, suis-le/la immédiatement.",
 "fr|he,en": "LANGUE PAR DÉFAUT DU TENANT : français (code: fr).\n- Utilise cette langue pour le tout premier message d'accueil.\n- LANGUES PARLÉES : français (fr), hébreu (he), anglais (US) (en). Si ton interlocuteur parle l'une d'elles, réponds STRICTEMENT dans la sienne et suis-le/la s'il/elle bascule entre elles.\n- S'il/elle parle une autre langue, réponds poliment en français.",
 "he|fr": "LANGUE PAR DÉFAUT DU TENANT : hébreu (code: he).\n- Utilise cette langue pour le tout premier message d'accueil.\n- LANGUES PARLÉES : hébreu (he), français (fr). Si ton interlocuteur parle l'une d'elles, réponds STRICTEMENT dans la sienne et suis-le/la s'il/elle bascule entre elles.\n- S'il/elle parle une autre langue, réponds poliment en hébreu.",
 "en|fr,he": "LANGUE PAR DÉFAUT DU TENANT : anglais (US) (code: en).\n- Utilise cette langue pour le tout premier message d'accueil.\n- LANGUES PARLÉES : anglais (US) (en), français (fr), hébreu (he). Si ton interlocuteur parle l'une d'elles, réponds STRICTEMENT dans la sienne et suis-le/la s'il/elle bascule entre elles.\n- S'il/elle parle une autre langue, réponds poliment en anglais (US)."
};

const ANSWER_IN_THEIRS = /détecte sa langue et réponds STRICTEMENT dans la sienne|réponds STRICTEMENT dans la sienne|suis-le\/la|réponds poliment en/;

// lock off → golden vs main, single and multi-language, with and without the new argument
for (const [key, golden] of Object.entries(MAIN)) {
  const [primary, list] = key.split("|");
  const languages = (list ? list.split(",") : []) as PersonaLanguage[];
  assert.equal(inboundLanguageDirective(primary!, languages), golden, `lock off, no arg: ${key}`);
  assert.equal(inboundLanguageDirective(primary!, languages, null), golden, `lock off, null: ${key}`);
  const off = lockedLanguage({ languageLock: false, languageHint: "he" }, primary);
  assert.equal(off, null, "lock off → no locked language, whatever the hint");
  assert.equal(inboundLanguageDirective(primary!, languages, off), golden, `lock off via lockedLanguage: ${key}`);
}

// languageHint vs auto → the worker's language() rule
assert.equal(lockedLanguage({ languageLock: true, languageHint: "auto" }, "he"), "he");
assert.equal(lockedLanguage({ languageLock: true, languageHint: "auto" }, "en"), "en");
assert.equal(lockedLanguage({ languageLock: true, languageHint: "auto" }, null), "fr");
assert.equal(lockedLanguage({ languageLock: true, languageHint: "auto" }, ""), "fr");
assert.equal(lockedLanguage({ languageLock: true, languageHint: "en" }, "fr"), "en");
assert.equal(lockedLanguage({ languageLock: true, languageHint: "he" }, "en"), "he");

// lock on → no "answer in theirs" sentence, the locked language named, whatever the list
{
  const exact = `LANGUE PAR DÉFAUT DU TENANT : français (code: fr).
- Utilise cette langue pour le tout premier message d'accueil.
- LANGUE VERROUILLÉE : réponds TOUJOURS en français (code: fr), même si ton interlocuteur parle une autre langue ou en change.`;
  assert.equal(inboundLanguageDirective("fr", [], "fr"), exact);
  for (const [key] of Object.entries(MAIN)) {
    const [primary, list] = key.split("|");
    const languages = (list ? list.split(",") : []) as PersonaLanguage[];
    for (const locked of ["fr", "he", "en"]) {
      const d = inboundLanguageDirective(primary!, languages, locked);
      assert.doesNotMatch(d, ANSWER_IN_THEIRS, `lock on ${locked}: ${key}`);
      assert.doesNotMatch(d, /LANGUES PARLÉES/, "the spoken-languages list would contradict the lock");
      const label = { fr: "français", he: "hébreu", en: "anglais \\(US\\)" }[locked]!;
      assert.match(d, new RegExp(`réponds TOUJOURS en ${label} \\(code: ${locked}\\)`));
      assert.match(d, new RegExp(`^LANGUE PAR DÉFAUT DU TENANT : .* \\(code: ${primary}\\)\\.`), "default-language part kept");
      assert.equal(d.split("\n").length, 3, "one greeting line + one language rule");
    }
  }
}

// through the session builder: lock read from the stored voice_profile column
{
  const directives = {
    globalByPlan: {}, spokenTimeByPlan: {}, spokenPhoneByPlan: {}, hangupByPlan: {}, configBlocksByPlan: {},
    blockOrderByPlan: { premium: ["language"] }, capabilitiesByPlan: { premium: "Mock capabilities." },
  };
  const caps = { calendar: false, crm: false, orders: false };
  const base = { inheritAdminGlobals: true, primaryLanguage: "he", personaConfig: null, business: null, instructions: null, knowledge: null };
  const lang = (voiceProfile: unknown) =>
    inboundSessionInstructions({ config: { ...base, voiceProfile }, planKey: "premium", directives, capabilities: caps }).split(BLOCK_SEPARATOR)[0];
  // off: null, {}, a full default profile, an explicit false with a hint → main's text
  for (const vp of [null, {}, DEFAULT_VOICE_PROFILE, { languageLock: false, languageHint: "en" }, { languageLock: "yes" }]) {
    assert.equal(lang(vp), MAIN["he|"], `off: ${JSON.stringify(vp)}`);
  }
  assert.match(lang({ languageLock: true })!, /réponds TOUJOURS en hébreu \(code: he\)/, "auto → primaryLanguage");
  assert.match(lang({ languageLock: true, languageHint: "en" })!, /réponds TOUJOURS en anglais \(US\) \(code: en\)/, "hint wins");
  assert.doesNotMatch(lang({ languageLock: true, languageHint: "fr" })!, ANSWER_IN_THEIRS);
}

console.log("ALL INBOUND-LANGUAGE-LOCK TESTS PASSED");
