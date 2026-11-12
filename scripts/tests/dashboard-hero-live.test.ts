// Dashboard hero: it only says "online" / "Live" when the account has a
// phone number. No number means no call can reach the agent, so the eyebrow
// and the status badge say so plainly, in every locale. Mock data only.
// Run with:  npx tsx scripts/tests/dashboard-hero-live.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroSection } from "../../app/[locale]/dashboard/config/hero-section";
import { heroLiveState } from "../../app/[locale]/dashboard/config/hero-live-state";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
const messages = (locale: string) =>
  JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8")) as Record<
    string,
    Record<string, string>
  >;
const MOCK_PHONE = "+972500000000";

// Words that claim the line is up, per locale (case-insensitive).
const ONLINE_WORDS: RegExp[] = [
  /en ligne/i,
  /\bonline\b/i,
  /\blive\b/i,
  /\bactif\b|\bactive\b/i,
  /פעיל/, // active
  /חי/, // live
  /מחובר/, // connected
  /אונליין|און ליין/, // online
  /מקוון/, // online
];

const Intl = NextIntlClientProvider as unknown as ComponentType<{
  locale: string;
  messages: unknown;
  timeZone?: string;
  children?: ReactNode;
}>;

function render(locale: string, primaryPhone: string | null) {
  return renderToStaticMarkup(
    createElement(
      Intl,
      { locale, messages: messages(locale), timeZone: "UTC" },
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

// Visible text only (drops tags and attributes such as class names).
const text = (html: string) => html.replace(/<[^>]*>/g, " ");

// 1. The state helper: a number (and only a non-blank one) is "live".
assert.deepEqual(heroLiveState(MOCK_PHONE), {
  live: true,
  eyebrowStatusKey: "heroLive",
  badgeKey: "wowLiveLabel",
});
for (const none of [null, undefined, "", "   "]) {
  assert.equal(heroLiveState(none).live, false, `no number: ${JSON.stringify(none)}`);
}

// 2. Same keys in all three locales: the hero's DashboardConfig keys exist
// everywhere, and DashboardConfig has the same key set in fr/en/he.
const HERO_KEYS = ["heroEyebrow", "heroLive", "heroOffline", "wowLiveLabel", "wowOfflineLabel", "heroNoNumber"];
const frKeys = Object.keys(messages("fr").DashboardConfig).sort();
for (const locale of LOCALES) {
  const dc = messages(locale).DashboardConfig;
  for (const k of HERO_KEYS) assert.ok(typeof dc[k] === "string" && dc[k].trim(), `${locale}: ${k}`);
  assert.deepEqual(Object.keys(dc).sort(), frKeys, `${locale}: DashboardConfig keys match fr`);
  assert.ok(messages(locale).DashboardSetup.numberCta, `${locale}: DashboardSetup.numberCta`);
}

for (const locale of LOCALES) {
  const dc = messages(locale).DashboardConfig;

  // 3. No number: no word claiming the line is up, the offline wording
  // instead, nothing pinging or waving, and the "get a number" link.
  const offStrings = [dc.heroOffline, dc.wowOfflineLabel, dc.heroNoNumber];
  for (const s of offStrings) {
    for (const re of ONLINE_WORDS) assert.ok(!re.test(s), `${locale}: "${s}" matches ${re}`);
  }
  const off = render(locale, null);
  const offText = text(off);
  for (const re of ONLINE_WORDS) assert.ok(!re.test(offText), `${locale} no number: hero text matches ${re}`);
  assert.ok(offText.includes(dc.heroOffline), `${locale}: eyebrow says offline`);
  assert.ok(offText.includes(dc.wowOfflineLabel), `${locale}: badge says offline`);
  assert.ok(offText.includes(dc.heroNoNumber), `${locale}: no-number line`);
  assert.ok(off.includes('href="/onboarding"') || /href="\/[a-z]{2}\/onboarding"/.test(off), `${locale}: link to get a number`);
  assert.ok(!off.includes("animate-ping"), `${locale}: no live ping without a number`);
  assert.ok(!off.includes("animate-[wave"), `${locale}: waveform still without a number`);

  // 4. With a number: today's rendering (number, "online 24/7", "Live",
  // both pings and the moving waveform), no offline wording.
  const on = render(locale, MOCK_PHONE);
  const onText = text(on);
  assert.ok(onText.includes(dc.heroLive), `${locale}: eyebrow says online`);
  assert.ok(onText.includes(dc.wowLiveLabel), `${locale}: badge says Live`);
  assert.ok(!onText.includes(dc.heroOffline), `${locale}: no offline wording with a number`);
  assert.ok(!onText.includes(dc.heroNoNumber), `${locale}: no "no number" line with a number`);
  assert.ok(/972/.test(onText), `${locale}: number shown`);
  assert.equal(on.match(/animate-ping/g)?.length, 2, `${locale}: eyebrow and badge ping`);
  assert.ok(on.includes("animate-[wave"), `${locale}: waveform moves`);
}

console.log("dashboard-hero-live: ok");
