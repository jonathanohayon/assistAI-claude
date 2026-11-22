// Dashboard hero: the phone number's type size follows its card (container
// query units), not a fixed size, so the whole number always fits on one
// line. A fixed sm:text-6xl clipped "+972 50-000-0001" at 1280 px and every
// number at 1024 px. Mock numbers only.
// Run with:  npx tsx scripts/tests/hero-number-fit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HERO_NUMBER_CONTAINER,
  HERO_NUMBER_SIZE,
  HeroSection,
} from "../../app/[locale]/dashboard/config/hero-section";

const ROOT = new URL("../../", import.meta.url).pathname;
const Intl = NextIntlClientProvider as unknown as ComponentType<{
  locale: string;
  messages: unknown;
  timeZone?: string;
  children?: ReactNode;
}>;

function render(locale: string, primaryPhone: string) {
  const messages = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
  return renderToStaticMarkup(
    createElement(
      Intl,
      { locale, messages, timeZone: "UTC" },
      createElement(HeroSection, {
        primaryPhone,
        lastUpdatedLabel: "",
        planLabel: "Mock plan",
        voice: "mock-voice",
        currentLangLabel: "Mock",
      }),
    ),
  );
}

// 1. The size is container-relative, capped at the old sizes, never fixed.
assert.equal(HERO_NUMBER_CONTAINER, "@container");
const sizes = HERO_NUMBER_SIZE.split(/\s+/);
assert.equal(sizes.length, 2, "one size for phones, one from sm up");
const ratios: number[] = [];
for (const s of sizes) {
  const m = s.match(/^(?:sm:)?text-\[clamp\(([\d.]+)rem,([\d.]+)cqi,([\d.]+)rem\)\]$/);
  assert.ok(m, `container-relative clamp(): ${s}`);
  ratios.push(Number(m[2]));
}
assert.deepEqual(
  sizes.map((s) => s.match(/,([\d.]+)rem\)\]$/)![1]),
  ["2.25", "3.75"],
  "caps stay at the old sizes (2.25rem, text-6xl)",
);
// The widest real format ("+972 50-000-0001") measures ~8.95 em in the
// display font (measured in Chromium). At r cqi it takes 8.95 * r % of the
// card: keep at least 5 % of room.
for (const r of ratios) assert.ok(8.95 * r <= 95, `${r}cqi leaves room for a 9 em number`);

// 2. The rendered number uses it, inside its container, on one line, LTR.
for (const locale of ["fr", "en", "he"]) {
  for (const phone of ["+972500000001", "+33199000001", "+12025550101", "+442079460958"]) {
    const html = render(locale, phone);
    const m = html.match(/<div class="@container"><p dir="ltr" class="([^"]*)"/);
    assert.ok(m, `${locale} ${phone}: number <p dir=ltr> inside an @container wrapper`);
    const cls = m[1].split(/\s+/);
    for (const s of sizes) assert.ok(cls.includes(s), `${locale} ${phone}: has ${s}`);
    assert.ok(cls.includes("whitespace-nowrap"), "one line");
    // No fixed size utility (text-6xl, sm:text-5xl, text-[60px]...) next to it.
    const fixed = cls.filter((c) => /^(?:\w+:)?text-(?:\d?xl|\[\d)/.test(c) || /^(?:\w+:)?text-\[clamp\([^)]*vw/.test(c));
    assert.deepEqual(fixed, [], `${locale} ${phone}: no fixed or viewport size`);
    // Never ellipsis or truncation on a phone number.
    assert.ok(!cls.some((c) => /truncate|ellipsis|text-clip|overflow-hidden/.test(c)), "never truncated");
  }
}

console.log("hero-number-fit: ok");
