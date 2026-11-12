// Public nav wordmark: white over a dark hero (the home's video, the /sales
// command centre) while the nav is transparent; purple once the nav shows its
// white bar (scrolled, drawer open) and from the top over a light hero
// (/connect, overLight). Renders the REAL Logo to static HTML.
// Run with:  npx tsx scripts/tests/nav-wordmark-tone.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Logo } from "../../components/ui/Logo";
import { navBarIsWhite, wordmarkTone, type NavToneState } from "../../lib/marketing/nav-tone";

const at = (s: Partial<NavToneState>): NavToneState => ({ scrolled: false, overLight: false, open: false, ...s });

// 1. The state table.
// Dark hero, not scrolled: transparent nav, white wordmark.
assert.equal(navBarIsWhite(at({})), false);
assert.equal(wordmarkTone(at({})), "onDark");
// Scrolled: the white bar, purple wordmark.
assert.equal(navBarIsWhite(at({ scrolled: true })), true);
assert.equal(wordmarkTone(at({ scrolled: true })), "brand");
// Light hero (overLight): the white bar from the top, purple wordmark.
assert.equal(navBarIsWhite(at({ overLight: true })), true);
assert.equal(wordmarkTone(at({ overLight: true })), "brand");
assert.equal(wordmarkTone(at({ overLight: true, scrolled: true })), "brand");
// Drawer open: the white bar, purple wordmark.
assert.equal(wordmarkTone(at({ open: true })), "brand");

// 2. The real Logo: purple by default (every other screen), white on dark.
// The wordmark is plain text in both tones: no halo or other child element.
const wordmark = (html: string) => /<span class="(font-display[^"]*)">Tamara<\/span>/.exec(html)?.[1] ?? "";
const brandHtml = renderToStaticMarkup(createElement(Logo));
const brand = wordmark(brandHtml);
assert.match(brand, /text-\[#8b5cf6\]/);
assert.doesNotMatch(brand, /text-white/);
const onDarkHtml = renderToStaticMarkup(createElement(Logo, { tone: "onDark" }));
const onDark = wordmark(onDarkHtml);
assert.match(onDark, /text-white/);
assert.doesNotMatch(onDark, /text-\[#8b5cf6\]/);
for (const html of [brandHtml, onDarkHtml]) {
  assert.doesNotMatch(html, /halo|blur-|bg-black/, "no halo behind the wordmark");
}
// The mic badge does not change with the tone.
const badge = (html: string) => /<span class="(relative inline-flex h-7[^"]*)"/.exec(html)?.[1];
assert.equal(badge(renderToStaticMarkup(createElement(Logo, { tone: "onDark" }))), badge(renderToStaticMarkup(createElement(Logo))));

// 3. The nav wires the wordmark and its bar to the same state, from its own
// scroll state (no window or reduced-motion read on the first render).
const nav = readFileSync(join(__dirname, "..", "..", "components/marketing/Nav.tsx"), "utf8");
assert.match(nav, /const \[scrolled, setScrolled\] = useState\(false\);/);
assert.match(nav, /const tone = \{ scrolled, overLight, open \};/);
assert.match(nav, /<Logo tone=\{wordmarkTone\(tone\)\} \/>/);
assert.match(nav, /navBarIsWhite\(tone\)\s*\?\s*"border-b border-\[var\(--color-border\)\]\/60 bg-white\/80 backdrop-blur-lg"/);
assert.doesNotMatch(nav, /useReducedMotion/);

// 4. The nav scrim lives in the home's video hero only: a decorative,
// absolutely positioned top band that fades out below the nav. /sales and
// /connect (DoorHero) and the nav itself do not carry it.
const srcOf = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const hero = srcOf("components/marketing/Hero.tsx");
const scrims = hero.match(/<div[^>]*data-nav-scrim=""[^>]*\/>/g) ?? [];
assert.equal(scrims.length, 1, "one scrim in the video hero");
const scrim = scrims[0];
assert.match(scrim, /aria-hidden/);
assert.match(scrim, /className="pointer-events-none absolute inset-x-0 top-0 -z-20 h-40 bg-gradient-to-b from-black\/55 via-black\/30 to-transparent"/);
// No layout impact: absolute, no margin/padding, and no motion on it.
assert.doesNotMatch(scrim, /\b(m|p|mt|pt|mb|pb)-\d/);
assert.doesNotMatch(scrim, /motion|animate|style=/);
for (const p of ["components/marketing/Nav.tsx", "components/marketing/landing/DoorHero.tsx", "components/marketing/HomePage.tsx"]) {
  assert.doesNotMatch(srcOf(p), /nav-scrim/, `${p} has no nav scrim`);
}

console.log("nav-wordmark-tone: ok");
