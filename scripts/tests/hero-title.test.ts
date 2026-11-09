// Unit tests for heroTitleTokens (lib/hero-title.ts).
// Run with:  npx tsx scripts/tests/hero-title.test.ts

import assert from "node:assert/strict";

import { EMPHASIS_SLOT, heroTitleTokens } from "../../lib/hero-title";

const fill = (tpl: string) => tpl.replace("{emphasis}", EMPHASIS_SLOT);

// multi-word phrase highlighted as one unit, the period glued to it
assert.deepEqual(heroTitleTokens(fill("Never lose a client to an {emphasis}."), "unanswered call"), [
  { text: "Never" }, { text: "lose" }, { text: "a" }, { text: "client" }, { text: "to" }, { text: "an" },
  { text: "unanswered call", emphasis: true, trailing: "." },
]);
// French: apostrophes inside the phrase stay in it
const fr = heroTitleTokens(fill("Ne perdez plus un client parce que {emphasis}."), "personne n'a décroché");
assert.deepEqual(fr.at(-1), { text: "personne n'a décroché", emphasis: true, trailing: "." });
// Hebrew (RTL text, same logic)
const he = heroTitleTokens(fill("אל תאבדו לקוח בגלל {emphasis}."), "שיחה שלא נענתה");
assert.deepEqual(he.at(-1), { text: "שיחה שלא נענתה", emphasis: true, trailing: "." });
// emphasis in the middle (the previous headline shape)
assert.deepEqual(heroTitleTokens(fill("Speak {emphasis} to every customer."), "human"), [
  { text: "Speak" }, { text: "human", emphasis: true }, { text: "to" }, { text: "every" }, { text: "customer." },
]);
// no slot in the template: plain words
assert.deepEqual(heroTitleTokens("Hello world", "x"), [{ text: "Hello" }, { text: "world" }]);

console.log("ALL HERO-TITLE TESTS PASSED");
