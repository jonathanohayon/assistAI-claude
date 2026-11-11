// Dashboard home pass: one "get a number" CTA, number-before-unit stats in
// Hebrew, no tile reorder hint. Mock data only.
// Run with:  npx tsx scripts/tests/dashboard-home.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SetupChecklist } from "../../components/dashboard/SetupChecklist";
import { HeroSection } from "../../app/[locale]/dashboard/config/hero-section";
import { splitDuration } from "../../app/[locale]/dashboard/config/stat-format";
import type { DashboardStats } from "../../app/[locale]/dashboard/config/types";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messagesFor = (locale: string) => JSON.parse(read(`messages/${locale}.json`));

const Intl = NextIntlClientProvider as unknown as ComponentType<{
  locale: string;
  messages: unknown;
  timeZone?: string;
  children?: ReactNode;
}>;

// The home as the page renders it for a tenant without a number:
// setup checklist first, then the hero (stats included).
const renderHome = (locale: string, stats: DashboardStats) =>
  renderToStaticMarkup(
    createElement(
      Intl,
      { locale, messages: messagesFor(locale), timeZone: "UTC" },
      createElement(
        Fragment,
        null,
        createElement(SetupChecklist, {
          hasPhone: false,
          googleConnected: false,
          businessFilled: false,
          whatsappSet: false,
        }),
        createElement(HeroSection, {
          primaryPhone: null,
          stats,
          lastUpdatedLabel: "",
          planLabel: "Pro",
          voice: "shimmer",
          currentLangLabel: "—",
        }),
      ),
    ),
  );

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const estimated: DashboardStats = { callsToday: 0, conversion: 0, avgSeconds: 245, rdv: 0, minutesThisMonth: 0 };
const measured: DashboardStats = { ...estimated, minutesThisMonth: 12, rdvSince: null };

// 1. Exactly one "get a number" call to action: the setup checklist's.
for (const locale of ["fr", "en", "he"]) {
  const m = messagesFor(locale);
  const html = renderHome(locale, estimated);
  assert.equal(count(html, `>${m.DashboardSetup.numberCta}<`), 1, `${locale}: one get-a-number CTA`);
  assert.equal(m.DashboardConfig.heroGetNumber, undefined, `${locale}: hero CTA key removed`);
  assert.ok(html.includes(m.DashboardConfig.heroNoPhone), `${locale}: hero still says there is no number`);
}

// 2. Hebrew stats: number first, then the unit (no "min" concatenated).
{
  const he = renderHome("he", measured);
  assert.ok(he.includes(">12 דק׳<"), "he: minutes = number then unit");
  assert.ok(!/\d+ min\b/.test(he), "he: no Latin 'min' unit");
  assert.ok(he.includes(">4 דק׳ 5 שנ׳<"), "he: average duration = number then unit");
  assert.ok(he.includes(">0%<"), "he: booking rate");
  const heEstimated = renderHome("he", estimated);
  assert.ok(heEstimated.includes(">≈ 0 דק׳<"), "he: estimated minutes keep the number before the unit");
  const fr = renderHome("fr", measured);
  assert.ok(fr.includes(">12 min<") && fr.includes(">4 min 5 s<"), "fr: unchanged order");
  // Each locale's minute message puts {count} before its unit.
  for (const locale of ["fr", "en", "he"]) {
    assert.match(messagesFor(locale).DashboardConfig.statMinutesValue, /^\{count\} \S/, `${locale}: {count} first`);
  }
  assert.equal(splitDuration(0), null);
  assert.deepEqual(splitDuration(245), { min: 4, sec: 5 });
  assert.equal(splitDuration(Number.NaN), null);
  const heroSrc = read("app/[locale]/dashboard/config/hero-section.tsx");
  assert.doesNotMatch(heroSrc, /\} min`/, "no string-concatenated unit");
}

// 3. The tile reorder hint is gone (key and usage); drag and drop stays.
{
  for (const locale of ["fr", "en", "he"]) {
    assert.equal(messagesFor(locale).DashboardConfig.wowTileReorderHint, undefined, `${locale}: reorder hint key removed`);
  }
  const form = read("app/[locale]/dashboard/config-form.tsx");
  assert.doesNotMatch(form, /wowTileReorderHint/);
  assert.match(form, /setDragTileId/, "drag and drop still wired");
}

console.log("ALL DASHBOARD-HOME TESTS PASSED");
