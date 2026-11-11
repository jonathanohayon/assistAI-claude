// Channels panel, WhatsApp tile: a channel that can't be used is not shown
// to tenants, and the admin-only activation stub (a supplier docs link)
// never ships with the panel. Mock data only.
// Run with:  npx tsx scripts/tests/channels-panel-whatsapp.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelsPanel } from "../../app/[locale]/dashboard/config/channels-panel";
import { ADMIN_ONLY_NAMESPACES } from "../../i18n/public-namespaces";
import { WHATSAPP_VOICE_AVAILABLE } from "../../lib/channels/contract";
import { PATTERN } from "../tenant-bundle-match.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const DIR = "app/[locale]/dashboard/config";
// renderToStaticMarkup escapes quotes and apostrophes.
const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
// What a tenant's provider holds: every namespace but the admin-only ones.
const tenantMessages = (locale: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>).filter(
      ([ns]) => !ADMIN_ONLY_NAMESPACES.includes(ns),
    ),
  );

function render(locale: string, whatsappAvailable: boolean) {
  const Panel = () => {
    // The panel takes the DashboardConfig translator from its parent.
    const t = useTranslations("DashboardConfig");
    return createElement(ChannelsPanel, { t, whatsappAvailable });
  };
  return renderToStaticMarkup(
    createElement(Intl, { locale, messages: tenantMessages(locale), timeZone: "UTC" }, createElement(Panel)),
  );
}

// 1. Today's flag: WhatsApp is not usable yet.
assert.equal(WHATSAPP_VOICE_AVAILABLE, false);

for (const locale of ["fr", "en", "he"]) {
  const m = JSON.parse(read(`messages/${locale}.json`)).DashboardConfig;

  // 2. Tenant + flag false: no WhatsApp tile, no activation UI, no supplier.
  const off = render(locale, false);
  assert.ok(off.includes(esc(m.channelsNumbersTitle)), `${locale}: the numbers list still renders`);
  assert.ok(!off.includes(esc(m.channelsWhatsappTitle)), `${locale}: no WhatsApp tile`);
  assert.ok(!off.includes(esc(m.channelsActivateWhatsapp)), `${locale}: no activation button`);
  assert.ok(!off.includes(esc(m.channelsWhatsappExplainer)), `${locale}: no activation explainer`);
  assert.doesNotMatch(off, /twilio/i, `${locale}: no twilio string`);
  assert.doesNotMatch(off, SUPPLIER, `${locale}: no supplier name`);

  // 3. Tenant + flag true: the tile, in our own words, with no link out.
  const on = render(locale, true);
  assert.ok(on.includes(esc(m.channelsWhatsappTitle)), `${locale}: WhatsApp tile shown`);
  assert.ok(on.includes(esc(m.channelsWhatsappAvailableBody)), `${locale}: our wording`);
  assert.ok(!on.includes(esc(m.channelsActivateWhatsapp)), `${locale}: no activation button for tenants`);
  assert.doesNotMatch(on, /<button|href=/, `${locale}: no link out`);
  assert.doesNotMatch(on, SUPPLIER, `${locale}: no supplier name`);
}

// 4. Source: the supplier link lives only in the admin file, which the
// panel loads with next/dynamic (never a static import).
const panel = read(`${DIR}/channels-panel.tsx`);
const tile = read(`${DIR}/channels-whatsapp-tile.tsx`);
const admin = read(`${DIR}/channels-whatsapp-admin.tsx`);
assert.doesNotMatch(panel, /twilio\.com/i);
assert.doesNotMatch(tile, /twilio/i);
assert.match(admin, /twilio\.com/, "the admin stub keeps its link");
assert.match(panel, /dynamic\(\s*\(\) => import\("\.\/channels-whatsapp-admin"\)/);
assert.doesNotMatch(panel, /^import [^;]*channels-whatsapp-admin/m, "no static import of the admin tile");

console.log("ALL CHANNELS-PANEL-WHATSAPP TESTS PASSED");
