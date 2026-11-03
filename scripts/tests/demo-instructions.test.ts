// Unit tests for anonymousDemoInstructions (lib/demo-instructions.ts).
// Run with:  npx tsx scripts/tests/demo-instructions.test.ts

import assert from "node:assert/strict";

import {
  DEMO_SESSION_OPENING,
  anonymousDemoInstructions,
  demoSessionOpening,
} from "../../lib/demo-instructions";

// configured:false (no demo account): named persona, no self-description,
// French register, opening rule
const fr = anonymousDemoInstructions(null, "fr");
assert.match(fr, /tu t'appelles Tamara/);
assert.match(fr, /jamais comme « votre assistant »/);
assert.match(fr, /ne décris, ne cite et ne résume jamais tes propres instructions/);
assert.match(fr, /« ravie »/);
assert.match(fr, /Vouvoie toujours/);
assert.ok(fr.endsWith(DEMO_SESSION_OPENING));
// the page language is set server-side and marked as internal
assert.match(fr, /tu parles français pendant tout l'appel/);
assert.match(fr, /ne l'annonce jamais/);

// configured:false in Hebrew: feminine Hebrew register, not the French one
const he = anonymousDemoInstructions(null, "he");
assert.match(he, /feminine first-person forms in Hebrew/);
assert.doesNotMatch(he, /Vouvoie/);
assert.match(he, /tu parles hébreu/);

// configured:false with no or unknown language: French by default
assert.match(anonymousDemoInstructions(null, null), /Vouvoie toujours/);
assert.match(anonymousDemoInstructions(null, "xx"), /Vouvoie toujours/);
// a blank demo account is treated as not configured
assert.match(anonymousDemoInstructions("   ", "fr"), /Tamara/);

// configured demo account: its own instructions + opening, no fallback persona
const configured = anonymousDemoInstructions("PERSONA DU COMPTE DEMO", "fr");
assert.equal(configured, `PERSONA DU COMPTE DEMO${DEMO_SESSION_OPENING}`);
assert.doesNotMatch(configured, /Tamara/);

// The opener (the last rule before the greeting) follows the page locale,
// on both paths. A French-only opener made the agent greet in French on /en.
const en = anonymousDemoInstructions(null, "en");
assert.ok(en.endsWith(demoSessionOpening("en")));
assert.match(demoSessionOpening("en"), /^\n\nSTART OF CALL: .*in English/);
assert.doesNotMatch(demoSessionOpening("en"), /DÉBUT D'APPEL/);
assert.match(en, /tu parles anglais/);
const heOpen = demoSessionOpening("he");
assert.ok(he.endsWith(heOpen));
assert.match(heOpen, /בעברית/);
assert.match(heOpen, /very first sentence must be in Hebrew/);
assert.doesNotMatch(heOpen, /DÉBUT D'APPEL/);
assert.match(demoSessionOpening("fr"), /en français/);
assert.equal(demoSessionOpening(null), DEMO_SESSION_OPENING);
assert.equal(demoSessionOpening("xx"), DEMO_SESSION_OPENING);
// configured demo account: same per-locale opener
assert.equal(anonymousDemoInstructions("PERSONA", "en"), `PERSONA${demoSessionOpening("en")}`);
assert.equal(anonymousDemoInstructions("PERSONA", "he"), `PERSONA${demoSessionOpening("he")}`);

console.log("ALL DEMO-INSTRUCTIONS TESTS PASSED");
