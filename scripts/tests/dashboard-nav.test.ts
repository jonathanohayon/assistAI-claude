// The dashboard's left menu (lib/dashboard-nav.ts, components/dashboard/
// DashboardSidebar.tsx) and its routes: the entry list per door (own product
// first, 8 entries, 2 blocks), the admin tenant view's list, the old URLs'
// redirects, the selector's removal, the config sections, the server gate of
// every page under the new routes, and the sidebar's keyboard/RTL wiring.
// Mock data only.
// Run with:  npx tsx scripts/tests/dashboard-nav.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardSidebar } from "../../components/dashboard/DashboardSidebar";
import { ProductPreviewHeader } from "../../components/dashboard/ProductPreviewHeader";
import { TILE_ROW_SIZE } from "../../app/[locale]/dashboard/config/tile-size";
import {
  activeEntry,
  homeHref,
  legacyTarget,
  LEGACY_ADMIN_PATHS,
  LEGACY_TENANT_PATHS,
  navBlocks,
  productOrder,
  ENTRY_SUFFIX,
  TILE_ENTRY,
} from "../../lib/dashboard-nav";
import { entitledProducts } from "../../lib/product-entitlement";
import { productMenu, type ProductMenu } from "../../lib/product-menu";
import {
  mergeSectionOrder,
  SECTION_TILES,
  sectionLiveTestBesideTiles,
  sectionShowsTiles,
  sectionGridClass,
  sectionTileSize,
  sectionShowsHero,
  sectionShowsLiveTest,
  sectionShowsSaveDock,
  tileInSection,
} from "../../app/[locale]/dashboard/config/sections";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const OWNED: ProductMenu = { reception: { state: "owned" }, sales: { state: "owned" }, connect: { state: "owned" } };
const premiumMenu = productMenu({ entitlement: entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null }), gates: { sales: false, connect: false }, isAdmin: false });

// ── 1. The entry list per door ──────────────────────────────────────────────
const SHARED = ["/dashboard/my-agent", "/dashboard/calls", "/dashboard/clients", "/dashboard/billing", "/dashboard/settings"];
const EXPECTED_PRODUCTS: Record<string, string[]> = {
  reception: ["/dashboard/reception", "/dashboard/sales", "/dashboard/agent"],
  sales: ["/dashboard/sales", "/dashboard/reception", "/dashboard/agent"],
  connect: ["/dashboard/agent", "/dashboard/reception", "/dashboard/sales"],
};
for (const door of ["reception", "sales", "connect", null, "junk"]) {
  const blocks = navBlocks(door, OWNED);
  const key = door === "sales" || door === "connect" ? door : "reception";
  assert.deepEqual(blocks.map((b) => b.id), ["products", "shared"], `${door}: 2 blocks`);
  assert.deepEqual(blocks[0].items.map((i) => i.href), EXPECTED_PRODUCTS[key], `${door}: own product first`);
  assert.deepEqual(blocks[1].items.map((i) => i.href), SHARED, `${door}: shared block`);
  assert.equal(blocks.flatMap((b) => b.items).length, 8, `${door}: 8 entries`);
  assert.deepEqual(blocks[1].items.map((i) => i.labelKey), ["myAgent", "calls", "clients", "billing", "settings"]);
  assert.equal(homeHref(door), EXPECTED_PRODUCTS[key][0], `${door}: /dashboard lands on the own product`);
  for (const i of blocks.flatMap((b) => b.items)) assert.equal(i.preview, undefined, "owned: no state label");
}
assert.deepEqual(productOrder("sales"), ["sales", "reception", "connect"]);
// Preview entries carry their CTA (premium, gates off: sales "soon", connect "soon").
assert.deepEqual(
  navBlocks("sales", premiumMenu)[0].items.map((i) => [i.id, i.preview ?? "owned"]),
  [["sales", "soon"], ["reception", "owned"], ["connect", "soon"]],
);
// The shared entries never carry a state.
for (const i of navBlocks("connect", premiumMenu)[1].items) assert.equal(i.preview, undefined);

// The admin tenant view: same component and table, URLs under /admin/users/<id>,
// no tenant settings page (7 entries).
{
  const blocks = navBlocks("connect", premiumMenu, "u-1");
  assert.deepEqual(blocks[0].items.map((i) => i.href), ["/admin/users/u-1/agent", "/admin/users/u-1/reception", "/admin/users/u-1/sales"]);
  assert.deepEqual(blocks[1].items.map((i) => i.href), ["/admin/users/u-1/my-agent", "/admin/users/u-1/calls", "/admin/users/u-1/clients", "/admin/users/u-1/finance"]);
  assert.equal(homeHref("sales", "u-1"), "/admin/users/u-1/sales");
  for (const [i, file] of [
    ["reception", "app/admin/users/[userId]/reception/page.tsx"],
    ["sales", "app/admin/users/[userId]/sales/page.tsx"],
    ["agent", "app/admin/users/[userId]/agent/page.tsx"],
    ["my-agent", "app/admin/users/[userId]/my-agent/page.tsx"],
    ["calls", "app/admin/users/[userId]/calls/page.tsx"],
    ["clients", "app/admin/users/[userId]/clients/page.tsx"],
    ["finance", "app/admin/users/[userId]/finance/page.tsx"],
  ]) assert.ok(existsSync(file), `admin ${i}: page exists`);
  // The mirror is gone: one sidebar for both.
  for (const f of ["app/admin/users/[userId]/_nav.tsx", "app/admin/users/[userId]/nav-tabs.ts", "app/[locale]/dashboard/_nav.tsx", "app/[locale]/dashboard/nav-tabs.ts"])
    assert.equal(existsSync(f), false, `${f} deleted`);
}

// Active entry: the page or any sub-page, locale prefix allowed.
assert.equal(activeEntry("/he/dashboard/reception/forwarding"), "reception");
assert.equal(activeEntry("/fr/dashboard/my-agent"), "myAgent");
assert.equal(activeEntry("/en/dashboard/agent"), "connect", "/agent is not /my-agent");
assert.equal(activeEntry("/fr/dashboard/billing/"), "billing");
assert.equal(activeEntry("/fr/dashboard"), null);
assert.equal(activeEntry("/admin/users/u-1/finance", "u-1"), "billing");
assert.equal(activeEntry("/admin/users/u-1/my-agent", "u-1"), "myAgent");
assert.equal(activeEntry("/admin/users/u-2/calls", "u-1"), null);

// ── 2. Old URL → new URL ────────────────────────────────────────────────────
const TENANT_REDIRECTS: [string, Record<string, string | string[]>, string | null, string][] = [
  ["", {}, null, "/dashboard/reception"],
  ["", {}, "reception", "/dashboard/reception"],
  ["", {}, "sales", "/dashboard/sales"],
  ["", {}, "connect", "/dashboard/agent"],
  ["", {}, "junk", "/dashboard/reception"],
  ["", { tile: "voice" }, "sales", "/dashboard/my-agent?tile=voice"],
  ["", { tile: "persona" }, null, "/dashboard/my-agent?tile=persona"],
  ["", { tile: "business" }, null, "/dashboard/my-agent?tile=business"],
  ["", { tile: "tools" }, "connect", "/dashboard/my-agent?tile=tools"],
  ["", { tile: "notifs" }, "sales", "/dashboard/my-agent?tile=notifs"],
  ["", { tile: "channels" }, null, "/dashboard/my-agent?tile=channels"],
  ["", { tile: "channels" }, "connect", "/dashboard/my-agent?tile=channels"],
  ["", { tile: "notifs" }, "reception", "/dashboard/my-agent?tile=notifs"],
  ["", { tile: "campaigns" }, null, "/dashboard/sales?tile=campaigns"],
  ["", { tile: "junk" }, "connect", "/dashboard/agent?tile=junk"],
  ["/logs", {}, null, "/dashboard/calls"],
  ["/crm", { connected: "1" }, null, "/dashboard/clients?connected=1"],
  ["/calendar", {}, null, "/dashboard/clients"],
  ["/contacts", {}, null, "/dashboard/clients"],
  ["/campaigns", { a: ["1", "2"] }, null, "/dashboard/sales?a=1&a=2"],
  ["/forwarding", {}, null, "/dashboard/reception/forwarding"],
];
for (const [from, q, door, to] of TENANT_REDIRECTS) assert.equal(legacyTarget(from, q, door), to, `/dashboard${from} ${JSON.stringify(q)} (${door})`);
assert.equal(legacyTarget("/settings", {}, null), null, "not an old URL");
assert.equal(legacyTarget("/toString", {}, null), null, "no prototype key");
assert.deepEqual(Object.keys(LEGACY_TENANT_PATHS).sort(), ["/calendar", "/campaigns", "/contacts", "/crm", "/forwarding", "/logs"]);
const ADMIN_REDIRECTS: [string, Record<string, string>, string | null, string | null][] = [
  ["", {}, null, "/admin/users/u-1/reception"],
  ["", {}, "connect", "/admin/users/u-1/agent"],
  ["", { tile: "prompt" }, "sales", "/admin/users/u-1/my-agent?tile=prompt"],
  ["", { tile: "channels" }, null, "/admin/users/u-1/my-agent?tile=channels"],
  ["", { tile: "notifs" }, "connect", "/admin/users/u-1/my-agent?tile=notifs"],
  ["/logs", {}, null, "/admin/users/u-1/calls"],
  ["/calendar", {}, null, "/admin/users/u-1/clients"],
  ["/contacts", {}, null, "/admin/users/u-1/clients"],
  ["/crm", {}, null, null],
];
for (const [from, q, door, to] of ADMIN_REDIRECTS) assert.equal(legacyTarget(from, q, door, "u-1"), to, `/admin/users/u-1${from}`);
assert.deepEqual(Object.keys(LEGACY_ADMIN_PATHS).sort(), ["/calendar", "/contacts", "/logs"]);
// Every tile has a home that exists.
assert.deepEqual(Object.keys(TILE_ENTRY).sort(), ["business", "campaigns", "channels", "notifs", "persona", "prompt", "tools", "voice"]);

// Every old page redirects with ITS suffix (the redirect runs in the page, so
// client navigation is covered too), and every target page exists.
{
  const tenant: [string, string][] = [["app/[locale]/dashboard/page.tsx", ""], ...Object.keys(LEGACY_TENANT_PATHS).map((s) => [`app/[locale]/dashboard${s}/page.tsx`, s] as [string, string])];
  for (const [file, suffix] of tenant) {
    assert.match(code(file), new RegExp(`return redirectTenantLegacy\\(locale, "${suffix}", await props\\.searchParams\\);`), file);
  }
  const admin: [string, string][] = [["app/admin/users/[userId]/page.tsx", ""], ...Object.keys(LEGACY_ADMIN_PATHS).map((s) => [`app/admin/users/[userId]${s}/page.tsx`, s] as [string, string])];
  for (const [file, suffix] of admin) {
    assert.match(code(file), new RegExp(`return redirectAdminLegacy\\(userId, "${suffix}", await props\\.searchParams\\);`), file);
  }
  for (const seg of [...Object.values(LEGACY_TENANT_PATHS), "reception", "sales", "agent", "my-agent", "calls", "clients", "billing", "settings"])
    assert.ok(existsSync(`app/[locale]/dashboard/${seg}/page.tsx`), `target ${seg} exists`);
  const helper = code("lib/dashboard-redirect.ts");
  assert.match(helper, /if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/, "tenant redirect: signed-in only");
  assert.match(helper, /redirect\(`\/\$\{locale\}\$\{to \?\? "\/dashboard"\}`\);/, "keeps the locale");
  assert.match(helper, /export async function redirectAdminLegacy[\s\S]*await requireAdminPage\(\);/, "admin redirect: admin gate first");
}

// ── 3. The selector is gone (the door still orders the products) ────────────
assert.equal(existsSync("components/dashboard/DoorSelect.tsx"), false);
for (const f of ["app/[locale]/dashboard/settings/page.tsx", "app/admin/users/[userId]/layout.tsx"]) {
  assert.doesNotMatch(read(f), /DoorSelect|Mon usage principal/, `${f}: no "main use" selector`);
}
for (const l of ["fr", "en", "he"]) assert.doesNotMatch(read(`messages/${l}.json`), /"doorLabel"|Mon usage principal/, `${l}: no selector words`);

// ── 4. Every page under the new routes keeps its server gate ────────────────
{
  const configPage = code("app/[locale]/dashboard/config/config-page.tsx");
  assert.match(configPage, /const session = await auth\(\);\s*if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/, "TenantConfigPage: signed-in tenant");
  assert.match(configPage, /\.where\(eq\(agentConfigs\.userId, session\.user\.id\)\)/, "TenantConfigPage: own config only");
  for (const [file, section] of [
    ["app/[locale]/dashboard/reception/page.tsx", "reception"],
    ["app/[locale]/dashboard/my-agent/page.tsx", "agent"],
  ]) assert.match(code(file), new RegExp(`<TenantConfigPage locale=\\{locale\\} section="${section}" />`), file);
  const sales = code("app/[locale]/dashboard/sales/page.tsx");
  assert.match(sales, /if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/);
  assert.match(sales, /const \{ isAdmin, enabled \} = await loadOutboundCampaignsAccess\(session\.user\.id\);/, "sales: the API's own gate");
  assert.match(sales, /const state = \(await loadAccountProductMenu\(session\.user\.id\)\)\.sales;/, "sales: its menu state");
  assert.match(sales, /if \(state\.state === "preview"\) \{[\s\S]*?<ProductPreviewHeader entry="sales" cta=\{state\.cta\} \/>\s*<SalesPreview \/>/, "sales: preview = its header + the sample workspace");
  assert.match(sales, /if \(!enabled\) return <TenantConfigPage locale=\{locale\} section="sales" \/>;/, "sales: locked otherwise = today's tile");
  assert.match(sales, /<CampaignsPageClient isAdmin=\{isAdmin\} captureOn=\{captureMode\(\) === "on"\} \/>/, "sales owned: today's workspace");
  const connect = code("app/[locale]/dashboard/agent/page.tsx");
  assert.match(connect, /if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/);
  assert.match(connect, /\{clientAgentEnabled\(clientAgentMode\(\), isAdmin\) && <ClientAgentBrick \/>\}/, "connect: the Ask-your-agent brick only where it is on");
  for (const f of ["app/[locale]/dashboard/clients/page.tsx", "app/[locale]/dashboard/reception/forwarding/page.tsx", "app/[locale]/dashboard/settings/page.tsx", "app/[locale]/dashboard/billing/page.tsx"])
    assert.match(code(f), /if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/, `${f}: signed-in`);
  const clients = code("app/[locale]/dashboard/clients/page.tsx");
  assert.match(clients, /hasCalendar=\{features\.calendar\}/, "clients: plan gate kept");
  assert.match(clients, /hasCrm=\{features\.crm\}/);
  assert.match(code("app/[locale]/dashboard/calls/page.tsx"), /await auth\(\)/);
  assert.match(code("app/[locale]/dashboard/calls/page.tsx"), /<DeveloperConsole isAdmin=\{isAdmin\} \/>/, "calls: console gate kept");
  assert.match(code("app/[locale]/dashboard/layout.tsx"), /if \(!session\?\.user\?\.id\) redirect\(`\/\$\{locale\}\/login`\);/, "layout: signed-in");
  // Admin tenant view: the admin gate on every page (or the helper it renders).
  assert.match(code("app/admin/users/[userId]/admin-config-page.tsx"), /export async function AdminTenantConfigPage[\s\S]*await requireAdminPage\(\);/);
  for (const [file, section] of [
    ["app/admin/users/[userId]/reception/page.tsx", "reception"],
    ["app/admin/users/[userId]/my-agent/page.tsx", "agent"],
  ]) assert.match(code(file), new RegExp(`<AdminTenantConfigPage userId=\\{userId\\} section="${section}" />`), file);
  for (const f of ["app/admin/users/[userId]/sales/page.tsx", "app/admin/users/[userId]/calls/page.tsx", "app/admin/users/[userId]/finance/page.tsx", "app/admin/users/[userId]/clients/calendar-section.tsx", "app/admin/users/[userId]/clients/contacts-section.tsx", "app/admin/users/[userId]/layout.tsx"])
    assert.match(code(f), /await requireAdminPage\(\);/, `${f}: admin gate`);
  const adminConnect = code("app/admin/users/[userId]/agent/page.tsx");
  assert.match(adminConnect, /await requireAdminPage\(\);/, "admin Votre agent: admin gate");
  assert.match(adminConnect, /<ClientAgentBrick asUserId=\{userId\} \/>/, "admin Votre agent: the brick, scoped to the tenant");
}

// ── 5. Config sections: the same form, each page its tiles ──────────────────
// The number and the notifications serve every product: their tiles are on
// Mon agent (real for every account), Réception keeps no tile.
assert.deepEqual(SECTION_TILES, {
  reception: [],
  agent: ["voice", "persona", "business", "tools", "channels", "notifs", "prompt"],
  sales: ["campaigns"],
});
for (const id of ["channels", "notifs"]) {
  assert.equal(tileInSection(id, "reception"), false, `${id}: not on Réception`);
  assert.equal(tileInSection(id, "agent"), true, `${id}: on Mon agent`);
}
// Each tile's ?tile= home is the page that shows it.
const SECTION_ENTRY = { reception: "reception", agent: "myAgent", sales: "sales" } as const;
for (const [section, ids] of Object.entries(SECTION_TILES) as [keyof typeof SECTION_ENTRY, readonly string[]][])
  for (const id of ids) assert.equal(TILE_ENTRY[id], SECTION_ENTRY[section], `?tile=${id} lands on the page that shows it`);
// Every in-app ?tile= link points at the page that shows that tile.
{
  const files = ["components/dashboard/SetupChecklist.tsx", "components/bricks/tools/ToolsBrick.tsx", "app/[locale]/dashboard/config-form.tsx"];
  let links = 0;
  for (const f of files)
    for (const m of read(f).matchAll(/\/([a-z-]+)\?tile=(\w+)\b/g)) {
      links++;
      assert.equal(m[1], ENTRY_SUFFIX[TILE_ENTRY[m[2]]], `${f}: ${m[0]} → /${ENTRY_SUFFIX[TILE_ENTRY[m[2]]]}?tile=${m[2]}`);
    }
  assert.ok(links >= 4, `the links were found (${links})`);
}
// The checklist's "agent address" step opens the Ask-your-agent brick on
// Votre agent (since #380 the address lives there, not in a tools tile).
{
  const checklist = read("components/dashboard/SetupChecklist.tsx");
  const step = checklist.slice(checklist.indexOf('id: "agentUrl"'), checklist.indexOf('id: "number"'));
  assert.match(step, /href: "\/dashboard\/agent#client-agent",/, "agentUrl step → the brick's anchor");
  assert.match(read("components/bricks/client-agent/ClientAgentBrick.tsx"), /<section\s+id="client-agent"/, "the anchor exists on the brick");
}
// The live test sits beside the tiles (right column, xl+) only on a page that
// has tiles: on Réception it goes full width under the hero. Mon agent unchanged.
assert.deepEqual(
  [sectionLiveTestBesideTiles("reception"), sectionLiveTestBesideTiles("agent"), sectionLiveTestBesideTiles("sales"), sectionLiveTestBesideTiles(undefined)],
  [false, true, false, true],
);
// Réception has no tile: no tile grid and no save dock (nothing to save there).
assert.deepEqual([sectionShowsTiles("reception"), sectionShowsTiles("agent"), sectionShowsTiles("sales"), sectionShowsTiles(undefined)], [false, true, true, true]);
assert.equal(sectionShowsSaveDock("reception"), false);
assert.equal(sectionShowsSaveDock(undefined), true);
// Every tile of the form is somewhere, each on ONE page (F2: "Ask your agent"
// left the tools tile, so Tools is on Mon agent only).
{
  const all = Object.values(SECTION_TILES).flat();
  assert.deepEqual([...new Set(all)].sort(), ["business", "campaigns", "channels", "notifs", "persona", "prompt", "tools", "voice"]);
  assert.deepEqual(all.filter((x, i) => all.indexOf(x) !== i), []);
}
assert.equal(tileInSection("voice", undefined), true, "no section = every tile");
assert.equal(tileInSection("voice", "reception"), false);
assert.deepEqual([sectionShowsHero("reception"), sectionShowsHero("agent"), sectionShowsHero("sales")], [true, false, false]);
assert.deepEqual([sectionShowsLiveTest("reception"), sectionShowsLiveTest("agent"), sectionShowsLiveTest("sales")], [true, true, false]);
assert.equal(sectionShowsSaveDock("sales"), false);
assert.equal(sectionShowsSaveDock("agent"), true);
// A drag on one page keeps the other pages' tiles where they were.
assert.deepEqual(mergeSectionOrder(["voice", "notifs", "business", "channels", "tools"], ["channels", "notifs"]), ["voice", "channels", "business", "notifs", "tools"]);
assert.deepEqual(mergeSectionOrder(["voice", "business"], ["business", "voice"]), ["business", "voice"]);
assert.deepEqual(mergeSectionOrder(["voice"], ["prompt"]), ["voice", "prompt"]);
{
  const form = code("app/[locale]/dashboard/config-form.tsx");
  assert.match(form, /const TILES = ALL_TILES\.filter\(\(tile\) => tileInSection\(tile\.id, section\)\);/);
  assert.match(form, /OPENABLE\.includes\(tileParam\) && tileInSection\(tileParam, section\)/, "?tile= opens only this page's tiles");
  assert.match(form, /\{sectionShowsHero\(section\) && \(/);
  assert.match(form, /\{sectionShowsLiveTest\(section\) && \(/);
  assert.match(form, /\{sectionShowsTiles\(section\) && \(\s*<section ref=\{tilesRef\}/);
  // The two-column layout and the sticky right column follow the same rule (Mon agent: as before).
  assert.match(form, /<div className=\{`relative \$\{sectionLiveTestBesideTiles\(section\) \? "xl:grid xl:grid-cols-\[minmax\(0,1fr\)_360px\] xl:gap-8" : ""\}`\}>/);
  assert.match(form, /<aside className=\{`card-hover anim-fade-up mb-8 \$\{sectionLiveTestBesideTiles\(section\) \? "xl:col-start-2 xl:row-start-2 xl:mb-0" : ""\}`\}>/);
  assert.match(form, /<div className=\{sectionLiveTestBesideTiles\(section\) \? "xl:sticky xl:top-24" : undefined\}>/);
  assert.match(form, /\{sectionShowsSaveDock\(section\) && \(/);
}

// ── 5b. Preview product pages: their own header, then the real screen over sample data (F2) ──
{
  const reception = code("app/[locale]/dashboard/reception/page.tsx");
  assert.match(reception, /if \(state\.state === "preview"\) \{[\s\S]*?<ProductPreviewHeader entry="reception" cta=\{state\.cta\} \/>\s*<ReceptionPreview \/>/);
  assert.match(reception, /return <TenantConfigPage locale=\{locale\} section="reception" \/>;/, "owned: today's layout");
  const connect = code("app/[locale]/dashboard/agent/page.tsx");
  assert.match(connect, /if \(state\.state === "preview"\) \{[\s\S]*?<ProductPreviewHeader entry="connect" cta=\{state\.cta\} \/>\s*<ConnectPreview \/>/);
  const form = code("app/[locale]/dashboard/config-form.tsx");
  assert.match(form, /\{gridHeading && \(\s*<div className="mb-4">\s*<h2/, "the generic heading is switchable");
  assert.match(code("app/[locale]/dashboard/config/config-page.tsx"), /gridHeading=\{gridHeading\}/);
  const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
  const render = (locale: string, entry: "reception" | "sales" | "connect", cta: "soon" | "try") =>
    renderToStaticMarkup(createElement(Intl, { locale, messages: JSON.parse(read(`messages/${locale}.json`)), timeZone: "UTC" }, createElement(ProductPreviewHeader, { entry, cta })));
  for (const locale of ["fr", "en", "he"]) {
    const m = JSON.parse(read(`messages/${locale}.json`));
    for (const entry of ["reception", "sales", "connect"] as const) {
      const soon = render(locale, entry, "soon");
      assert.ok(soon.includes(`<h1`) && soon.includes(m.DashboardNav[entry]), `${locale}/${entry}: the product name is the title`);
      const pitch = m.DashboardNav[`pitch${entry[0].toUpperCase()}${entry.slice(1)}`];
      assert.ok(typeof pitch === "string" && soon.includes(pitch.replace(/'/g, "&#x27;")), `${locale}/${entry}: one sentence on what it does`);
      const q = (x: string) => x.replace(/'/g, "&#x27;");
      // "soon": the plain line and NO button (no notify-me endpoint: no promise we can't keep).
      // "try": ONE button, "try it free".
      assert.ok(soon.includes(q(m.DashboardNav.previewSoon)), `${locale}/${entry}: "coming soon" line`);
      assert.ok(!soon.includes(q(m.DashboardNav.previewTry)), `${locale}/${entry}: no "try" while soon`);
      assert.equal((soon.match(/<(button|a)\b/g) ?? []).length, 0, `${locale}/${entry}: no button (soon)`);
      const tryIt = render(locale, entry, "try");
      assert.ok(tryIt.includes(q(m.DashboardNav.previewTry)), `${locale}/${entry}: "try it free"`);
      assert.ok(!tryIt.includes(q(m.DashboardNav.previewSoon)), `${locale}/${entry}: no "soon" line while try`);
      assert.equal((tryIt.match(/<(button|a)\b/g) ?? []).length, 1, `${locale}/${entry}: one button (try)`);
      if (entry !== "sales") assert.match(tryIt, /href="\/(fr|en|he)?\/?dashboard\/billing"|href="\/dashboard\/billing"/, `${locale}/${entry}: try → the subscription page`);
      assert.ok(!soon.includes(m.DashboardConfig.wowTileHintIdle), "no generic tile heading in the header");
    }
  }
  const fr = JSON.parse(read("messages/fr.json")).DashboardNav;
  assert.deepEqual([fr.previewTry, fr.previewSoon, fr.previewBadge], ["Essayer gratuitement", "Bientôt disponible.", "Aperçu"]);
  for (const l of ["fr", "en", "he"]) {
    const nav = JSON.parse(read(`messages/${l}.json`)).DashboardNav;
    assert.ok(!("previewNotify" in nav) && !("previewNotified" in nav), `${l}: no notify-me words`);
  }
  // No notify-me endpoint yet: nothing that would record or send a request.
  const hdrSrc = read("components/dashboard/ProductPreviewHeader.tsx");
  assert.doesNotMatch(hdrSrc, /fetch\(|localStorage|sessionStorage|sendBeacon|setNotified|previewNotif/, "no notify-me");
  const hdr = code("components/dashboard/ProductPreviewHeader.tsx");
  assert.match(hdr, /entry === "sales" \? \([\s\S]*<UpsellModal open=\{upsellOpen\}/, "sales: the campaigns upsell");
  assert.match(hdr, /<Link href="\/dashboard\/billing"/, "other products: the subscription page");
}

// ── 5c. Mon agent: two tiles per row (narrow column beside the live test) ──
assert.equal(sectionGridClass("agent"), "@container grid grid-cols-2 gap-3");
assert.equal(sectionTileSize("agent"), "min-h-[calc((100cqw_-_0.75rem)/2)]", "#370: at least a square at 2 columns");
assert.equal(sectionGridClass("reception"), "@container grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-4", "Réception's grid unchanged");
assert.equal(sectionTileSize("reception"), TILE_ROW_SIZE);
assert.equal(sectionGridClass(undefined), sectionGridClass("reception"));

// ── 6. The sidebar: keyboard, focus, RTL, brand ─────────────────────────────
{
  const src = code("components/dashboard/DashboardSidebar.tsx");
  assert.match(src, /"aria-current": isActive \? \("page" as const\) : undefined/, "aria-current on the active entry");
  assert.match(src, /bg-\[#be185d\] text-white/, "active entry in brand magenta");
  assert.match(src, /focus-visible:ring-2 focus-visible:ring-\[#0e7490\]/, "visible focus ring (cyan)");
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls="dashboard-drawer"/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /e\.key === "Escape"/, "Esc closes");
  assert.match(src, /e\.key !== "Tab"/, "focus trap");
  assert.match(src, /buttonRef\.current\?\.focus\(\)/, "focus back on the button");
  assert.match(src, /absolute inset-y-0 start-0/, "the drawer opens from the start side (right in Hebrew)");
  assert.doesNotMatch(src, /\b(left|right)-0\b|\bml-|\bmr-|\bpl-|\bpr-/, "logical sides only");
  assert.doesNotMatch(src, /from-\[#(?:db2777|ec4899|be185d)\][^"]*to-\[#(?:06b6d4|22d3ee|0e7490)\]/i, "never a pink→cyan gradient");
  assert.match(src, /asUserId \? \(\s*<NextLink/, "admin view: plain links (no locale under /admin)");
  for (const l of ["app/[locale]/dashboard/layout.tsx", "app/admin/users/[userId]/layout.tsx"]) {
    assert.match(read(l), /flex-col lg:flex-row/, `${l}: the menu column sits on the start side`);
  }
}

// Rendered: FR and HE (plural address keys exist), the active entry, the state labels.
{
  const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
  const html = (locale: string, blocks: ReturnType<typeof navBlocks>) =>
    renderToStaticMarkup(
      createElement(Intl, { locale, messages: JSON.parse(read(`messages/${locale}.json`)), timeZone: "UTC" }, createElement(DashboardSidebar, { blocks })),
    );
  const trial = productMenu({ entitlement: entitledProducts({ subscriptionPlan: "global", subscriptionStatus: "trialing", products: null }), gates: { sales: false, connect: true }, isAdmin: false });
  const fr = html("fr", navBlocks("connect", trial));
  const order = [...fr.matchAll(/data-entry="([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["connect", "reception", "sales", "myAgent", "calls", "clients", "billing", "settings"], "own product first, then the shared block");
  assert.match(fr, /data-entry="connect" data-state="preview-try"/);
  assert.match(fr, /data-entry="sales" data-state="preview-soon"/);
  assert.match(fr, /Essai gratuit/);
  assert.match(fr, /Bientôt/);
  assert.match(fr, />Produits</);
  assert.match(fr, />Commun</);
  assert.match(fr, /aria-expanded="false"/, "the drawer starts closed");
  assert.doesNotMatch(fr, /role="dialog"/, "closed drawer: not in the page");
  const he = html("he", navBlocks("reception", OWNED));
  for (const w of ["הסוכן שלכם", "הסוכן שלי", "מכירות", "שיחות", "לקוחות", "מנוי", "הגדרות"]) assert.ok(he.includes(w), `he: ${w}`);
  for (const l of ["fr", "en", "he"]) {
    const nav = JSON.parse(read(`messages/${l}.json`)).DashboardNav;
    assert.deepEqual(Object.keys(nav).sort(), Object.keys(JSON.parse(read("messages/fr.json")).DashboardNav).sort(), `${l}: same keys`);
    for (const v of Object.values(nav)) assert.ok(typeof v === "string" && v.trim() !== "");
  }
}

// The words guard and the bundle check cover the new routes.
for (const f of ["scripts/check-tenant-words.mjs", "scripts/check-tenant-bundle.mjs"]) {
  const src = read(f);
  for (const r of ["/dashboard/reception", "/dashboard/reception/forwarding", "/dashboard/sales", "/dashboard/agent", "/dashboard/my-agent", "/dashboard/calls", "/dashboard/clients"])
    assert.ok(src.includes(`"${r}"`), `${f}: ${r}`);
}

// The top bar reads "Tableau de bord" in French (English keeps "Dashboard").
assert.equal(JSON.parse(read("messages/fr.json")).Dashboard.header, "Tableau de bord");
assert.equal(JSON.parse(read("messages/en.json")).Dashboard.header, "Dashboard");

console.log("dashboard-nav: OK");
