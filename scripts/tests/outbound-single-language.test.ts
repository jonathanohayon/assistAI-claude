// One-line language instruction for single-language non-French outbound
// agents (lib/persona/languages.ts). Goldens + "only the line is added".
// Mock data only. Run with:  npx tsx scripts/tests/outbound-single-language.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { singleLanguageCases } from "./fixtures/outbound-single-language-cases";

const golden = JSON.parse(readFileSync(new URL("./fixtures/outbound-single-language-golden.json", import.meta.url), "utf8")) as Record<string, string>;
const now = singleLanguageCases();
assert.deepEqual(Object.keys(now), ["campaign en-only", "campaign he-only", "outbound test en-only"]);
assert.deepEqual(Object.keys(golden), Object.keys(now));
for (const k of Object.keys(golden)) assert.equal(now[k], golden[k], `golden: ${k}`);

const EN = "\n\nLANGUE PARLÉE : anglais (US) (en). Parle uniquement en anglais (US), du début à la fin de l'appel.";
const HE = "\n\nLANGUE PARLÉE : hébreu (he). Parle uniquement en hébreu, du début à la fin de l'appel.";
// The line is the only addition: it ends the instructions, once.
for (const [k, line] of [["campaign en-only", EN], ["campaign he-only", HE], ["outbound test en-only", EN]] as const) {
  assert.ok(now[k].endsWith(line), `${k} ends with the line`);
  assert.equal(now[k].split("LANGUE PARLÉE").length, 2, `${k}: the line appears once`);
  assert.ok(!now[k].includes("LANGUES PARLÉES"), `${k}: no multi-language block`);
}

console.log("ALL OUTBOUND-SINGLE-LANGUAGE TESTS PASSED");
