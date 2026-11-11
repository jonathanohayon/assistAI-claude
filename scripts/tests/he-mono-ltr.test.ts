// Design rule: URLs, code samples, secrets and ids are LTR + monospace in EVERY locale.
// On Hebrew pages `:lang(he)` puts Heebo on every element and (unlayered) beats Tailwind's
// `.font-mono` utility, so LTR mono content must be put back on --font-mono explicitly.
// Run with:  npx tsx scripts/tests/he-mono-ltr.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(new URL("../../", import.meta.url).pathname, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The rule that restores monospace for LTR content inside Hebrew pages.
const restore = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].find(([, sel, body]) => /font-family:\s*var\(--font-mono\)/.test(body) && /:lang\(he\)/.test(sel));
assert.ok(restore, "a :lang(he) rule restores var(--font-mono)");
const sel = restore![1];
assert.ok(sel.includes(':lang(he) .font-mono:is([dir="ltr"], [dir="ltr"] *)'), "LTR .font-mono (itself or inside dir=ltr)");
assert.ok(sel.includes(':lang(he) [dir="ltr"] :is(code, kbd, samp)'), "code/kbd/samp inside LTR");
assert.ok(sel.includes('.he-text .font-mono:is([dir="ltr"], [dir="ltr"] *)') && sel.includes('[lang="he"] .font-mono:is([dir="ltr"], [dir="ltr"] *)'), "the .he-text / [lang=he] fragments too");
// It must come AFTER the Hebrew Heebo rules (same-origin cascade order matters for equal specificity).
assert.ok(css.indexOf(restore![0]) > css.lastIndexOf(':lang(he) .font-mono,'), "after the Hebrew mono override");
// The mono stack still falls back to Heebo, so Hebrew glyphs inside LTR mono content render.
assert.match(css, /--font-mono:[^;]*monospace;/);
assert.match(css, /--font-mono:[^;]*Heebo/);

console.log("ALL HE-MONO-LTR TESTS PASSED");
