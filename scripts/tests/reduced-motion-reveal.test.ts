// Reduced-motion users must see the Reveal primitives in their final state
// from the first paint (the SSR HTML carries blur + offset + opacity 0).
// Run with:  npx tsx scripts/tests/reduced-motion-reveal.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// Extract every `@media (prefers-reduced-motion: reduce) { ... }` block.
const css = read("app/globals.css");
const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)].map((m) => {
  let depth = 0;
  for (let i = m.index! + m[0].length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(m.index!, i + 1);
  }
  return "";
});

// Inside one of them, [data-reveal] is pinned to its final state, with
// !important because motion writes inline styles.
const rule = blocks
  .map((b) => /\[data-reveal\]\s*\{([^}]*)\}/.exec(b)?.[1])
  .find((r) => r !== undefined);
assert.ok(rule, "a [data-reveal] rule must live inside @media (prefers-reduced-motion: reduce)");
assert.match(rule, /opacity:\s*1\s*!important/);
assert.match(rule, /transform:\s*none\s*!important/);
assert.match(rule, /filter:\s*none\s*!important/);

// Nothing outside reduced motion targets [data-reveal]: no change for others.
const outside = blocks.reduce((s, b) => s.replace(b, ""), css);
assert.doesNotMatch(outside, /\[data-reveal\]/);

// The primitives that start blurred and offset carry the attribute.
const reveal = read("components/marketing/Reveal.tsx");
for (const name of ["Reveal", "StaggerItem"]) {
  const body = reveal.slice(reveal.indexOf(`export function ${name}(`));
  const start = body.indexOf("<motion.div");
  const el = body.slice(start, body.indexOf(">", start));
  assert.match(el, /data-reveal=""/, `${name} must carry data-reveal`);
}

console.log("reduced-motion-reveal: ok");
