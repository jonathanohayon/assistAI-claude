// Notifications panel: a channel that can't be used is not shown at all.
// SMS has no sender yet, so no SMS card, no "soon" badge, no disabled row.
// The Email card ships with its own route and renders only once its settings
// are loaded (scripts/tests/owner-email-card.test.ts); without them (here) the
// panel shows no email switch or input. In fr/en/he, for a tenant
// and for an admin. The tile summary on /dashboard mentions neither. Renders the REAL NotifsPanel. Mock data only.
// Run with:  npx tsx scripts/tests/notifs-hide-soon.test.ts

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotifsPanel } from "../../app/[locale]/dashboard/config/notifs-panel";
import type { FormState } from "../../app/[locale]/dashboard/config/types";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));

// Only the fields the panel and its cards read; everything else is unused here.
const form = {
  ownerWhatsapp: "+972500000000",
  transferNumber: "",
  reminderEnabled: true,
  ownerDigestEnabled: true,
  ownerDigestHour: 20,
} as unknown as FormState;

function Panel({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("DashboardConfig");
  return createElement(NotifsPanel, { form, update: () => {}, t, isAdmin });
}

function render(locale: string, isAdmin: boolean) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(Panel, { isAdmin }),
    ),
  );
}

// The badge words as they shipped before (fr/en/he), so a revived badge is caught.
// renderToStaticMarkup escapes text; compare catalogue strings the same way.
const escape = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const SOON = /Bientôt|\bSoon\b|בקרוב/i;

for (const locale of ["fr", "en", "he"]) {
  for (const isAdmin of [false, true]) {
    const html = render(locale, isAdmin);
    const who = `${locale}/${isAdmin ? "admin" : "tenant"}`;
    // Sanity: the panel did render its real channels.
    assert.match(html, />WhatsApp</, `${who}: WhatsApp card rendered`);
    // The other rows still render: transfer number, J-1 reminder, owner digest, footer.
    const dc = messages(locale).DashboardConfig;
    for (const k of ["reminderTitle", "whatsappFooter"]) {
      assert.ok(html.includes(escape(dc[k])), `${who}: ${k} rendered`);
    }
    assert.ok((html.match(/role="switch"/g) ?? []).length >= 3, `${who}: WhatsApp, reminder and digest switches rendered`);
    // Email settings not loaded: no Email card, switch, input or test call.
    assert.doesNotMatch(html, />E-?mail</i, `${who}: no Email card`);
    assert.doesNotMatch(html, /aria-label="[^"]*E-?mail[^"]*"/i, `${who}: no email switch or test button`);
    assert.doesNotMatch(html, /type="email"/, `${who}: no email input`);
    assert.doesNotMatch(html, /contact@/, `${who}: no email placeholder`);
    assert.doesNotMatch(html, /email-test/, `${who}: no email test endpoint`);
    // The unavailable channel and its badge are absent from the DOM.
    assert.doesNotMatch(html, /\bSMS\b/, `${who}: no SMS card`);
    assert.doesNotMatch(html, SOON, `${who}: no "soon" badge`);
    // No dead switch left behind: every toggle can be used.
    assert.doesNotMatch(html, /role="switch"[^>]*disabled/, `${who}: no disabled switch`);
  }
  // The badge key itself is gone from the catalogue.
  assert.equal(messages(locale).DashboardConfig.wowComingSoon, undefined, `${locale}: wowComingSoon removed`);
  // Tile summary on /dashboard: neither string mentions SMS.
  const dc = messages(locale).DashboardConfig;
  for (const k of ["wowNotifsSummaryActive", "wowNotifsSummaryInactive", "wowTagNotifs"]) {
    assert.doesNotMatch(dc[k], /SMS/i, `${locale}: ${k} mentions SMS`);
    assert.doesNotMatch(dc[k], /e-?mail|courriel|אימייל|מייל|דוא"ל/i, `${locale}: ${k} mentions email`);
  }
}

// The summary is computed from WhatsApp only, never counts SMS.
const configForm = read("app/[locale]/dashboard/config-form.tsx");
assert.match(configForm, /summary: form\.ownerWhatsapp \? t\("wowNotifsSummaryActive"\) : t\("wowNotifsSummaryInactive"\)/);
// The panel source keeps no email state or endpoint behind the scenes.
{
  const leftover = read("app/[locale]/dashboard/config/notifs-panel.tsx").match(/emailOn|emailValue|email-test|label="Email"/);
  assert.equal(leftover, null, `notifs-panel.tsx: email leftover ${leftover?.[0]}`);
}
// The card no longer has a "coming soon" mode to fall back on.
assert.doesNotMatch(read("app/[locale]/dashboard/config/notif-channel-card.tsx"), /comingSoon/);

// The example number in the WhatsApp hint is an obviously fake one (never a plausible real person's number).
for (const l of ["fr", "en", "he"]) {
  const hint = JSON.parse(readFileSync(join(new URL("../../", import.meta.url).pathname, `messages/${l}.json`), "utf8")).DashboardConfig.ownerWhatsappHint as string;
  assert.match(hint, /\+972500000000/, `${l}: mock example number`);
  assert.doesNotMatch(hint, /\+97258/, `${l}: no plausible real number`);
}

// …and not as an example in front-end copy or placeholders. (The public support
// button uses a real support number ON PURPOSE — components/marketing/SupportFab.tsx —
// and API error strings are server-side; neither is an "example".)
{
  const hits = execSync("git grep -n 972585001007 -- messages 'app/[[]locale]' app/admin ':!app/api' || true", { cwd: new URL("../../", import.meta.url).pathname }).toString().trim();
  assert.equal(hits, "", `no plausible real example number left:\n${hits}`);
}

console.log("notifs-hide-soon: ok");
