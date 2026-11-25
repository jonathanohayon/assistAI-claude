// "Connecter vos agents" can never be empty (P1, 23/11): with CLIENT_AGENT
// unset (as in production) an admin owns every entry, the brick was hidden,
// and the page was a title and nothing else.
//   1. The table: menu state × showClientAgent × isAdmin → lib/connect-page-view.ts,
//      and EVERY row renders at least one content section (the connectors
//      list, or the closed product's header sentence + the sample brick), in
//      fr/en/he. C1b: every owned row is rendered with the account's
//      connectors as the server reads them: 0 connectors (the empty card),
//      the derived legacy card, and none read (the brick alone); every
//      preview row renders the SAME HTML whatever connectors are passed.
//      Admin rows: the admin line, no "Prévenez-moi"; tenant "soon" rows: the
//      button, no admin line.
//   2. Production's switches (CLIENT_AGENT=admin since T5c, CAMPAIGN_DISPATCH=dry;
//      and CLIENT_AGENT unset as before): the admin's own page (the list) and
//      a tenant who owns connect through an active trial (the closed
//      preview), from the real menu (menuFor) and the real switch
//      (clientAgentMode).
//   3. Source guard: both Connect pages decide through connectPageView, and
//      ConnectOwnedView is only mounted by ConnectPageContent.
//   4. The admin line: fr/en/he, no flag or env name, Hebrew writes Tamara in
//      Latin (it names none today).
// Mock data only, no request.
// Run with:  npx tsx scripts/tests/connect-page-view.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectPageContent } from "../../app/[locale]/dashboard/agent/connect-view";
import { connectPageView, type ConnectPageView } from "../../lib/connect-page-view";
import { MOCK_EXTRA_PRICE, MOCK_NOW, MOCK_PAGES } from "../../lib/connectors/mock";
import type { ConnectorsMount } from "../../lib/connectors/mount";
import { menuFor } from "../../lib/product-gates";
import type { ProductEntryState } from "../../lib/product-menu";
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "../../lib/product-trials";
import { clientAgentEnabled, clientAgentMode } from "../../lib/tools/client-agent-switch";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const ROUTER = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const TERMS = { days: PRODUCT_TRIAL_DAYS, minutes: PRODUCT_TRIAL_MINUTES };
const html = (l: string, node: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: ROUTER as never },
      createElement(NextIntlClientProvider, { locale: l, messages: messages(l), timeZone: "UTC" } as ProviderProps, node),
    ),
  );

/** The page's content sections in `out`: the connectors list, the live brick (mounted, loading) or the sample brick. */
function contentSections(l: string, out: string): string[] {
  const m = messages(l);
  const found: string[] = [];
  const list = out.includes("data-connectors-panel");
  if (list) {
    const empty = out.includes("data-connectors-empty") && out.includes(esc(m.ConnectorsList.empty.title));
    const cards = out.includes("data-connectors-list") && /data-connector="[^"]+"/.test(out);
    assert.ok(empty !== cards, "the list is the empty card XOR cards");
    found.push(empty ? "list:empty" : "list:cards");
  }
  if (!list && out.includes(`aria-busy="true">${esc(m.ToolsBrick.loading)}</p>`)) found.push("brick");
  if (out.includes('id="client-agent"') && out.includes(esc(m.DashboardNav.pitchConnect))) found.push("closed preview");
  return found;
}

// The owned view's connectors, as lib/connectors/mount.ts hands them (mock pages).
const BASE = { monthly: 39, currency: "EUR" as const, minutes: 100 };
const MOUNTS: Record<"none" | "empty" | "legacy", ConnectorsMount | null> = {
  none: null,
  empty: { page: MOCK_PAGES.emptyPaid, extraPrice: null, basePrice: BASE, now: MOCK_NOW },
  legacy: { page: MOCK_PAGES.derivedPaid, extraPrice: MOCK_EXTRA_PRICE.EUR, basePrice: BASE, now: MOCK_NOW },
};
const EXPECT_SECTION = { none: "brick", empty: "list:empty", legacy: "list:cards" } as const;

function render(l: string, view: ConnectPageView, notifyRequested = false, connectors: ConnectorsMount | null = null, asUserId: string | null = null): string {
  return html(
    l,
    createElement(ConnectPageContent, {
      view,
      title: messages(l).DashboardNav.connect,
      trialNote: null,
      notifyRequested,
      trial: undefined,
      trialTerms: TERMS,
      connectors,
      asUserId,
    }),
  );
}

function checkRendered(l: string, who: string, view: ConnectPageView, isAdmin: boolean, out: string, mount: keyof typeof MOUNTS = "none") {
  const m = messages(l).DashboardNav;
  assert.ok(out.includes(`${esc(m.connect)}</h1>`), `${who}: the title`);
  const sections = contentSections(l, out);
  assert.ok(sections.length >= 1, `${who}: at least one content section (got none)`);
  assert.equal(sections.length, 1, `${who}: one view, not both (${sections.join(", ")})`);
  const adminLine = out.includes(esc(m.connectAdminClosed));
  const notifyButton = out.includes(`>${esc(m.previewNotify)}</button>`);
  if (view.kind === "brick") {
    assert.deepEqual(sections, [EXPECT_SECTION[mount]], `${who}: the owned view (${mount})`);
    assert.ok(!adminLine && !notifyButton, `${who}: no admin line, no notify on the brick view`);
    return;
  }
  assert.deepEqual(sections, ["closed preview"], `${who}: the closed preview`);
  assert.equal(adminLine, isAdmin, `${who}: the admin line only for an admin`);
  if (isAdmin) assert.ok(!notifyButton, `${who}: no "Prévenez-moi" for an admin`);
  if (view.cta === "soon") {
    assert.ok(out.includes(`>${esc(m.previewSoon)}</p>`), `${who}: "Bientôt disponible."`);
    assert.equal(notifyButton, !isAdmin, `${who}: "Prévenez-moi" for a tenant only`);
  }
}

// ── 1. The table ────────────────────────────────────────────────────────────
const MENU: Array<[string, ProductEntryState]> = [
  ["owned", { state: "owned" }],
  ["preview soon", { state: "preview", cta: "soon" }],
  ["preview try", { state: "preview", cta: "try" }],
];
const EXPECTED: Record<string, ConnectPageView> = {
  "owned|true|false": { kind: "brick" },
  "owned|true|true": { kind: "brick" },
  "owned|false|false": { kind: "preview", cta: "soon", notify: true, adminNote: false },
  "owned|false|true": { kind: "preview", cta: "soon", notify: false, adminNote: true },
  "preview soon|true|false": { kind: "preview", cta: "soon", notify: true, adminNote: false },
  "preview soon|true|true": { kind: "preview", cta: "soon", notify: false, adminNote: true },
  "preview soon|false|false": { kind: "preview", cta: "soon", notify: true, adminNote: false },
  "preview soon|false|true": { kind: "preview", cta: "soon", notify: false, adminNote: true },
  "preview try|true|false": { kind: "preview", cta: "try", notify: true, adminNote: false },
  "preview try|true|true": { kind: "preview", cta: "try", notify: false, adminNote: true },
  "preview try|false|false": { kind: "preview", cta: "try", notify: true, adminNote: false },
  "preview try|false|true": { kind: "preview", cta: "try", notify: false, adminNote: true },
};
let rows = 0;
for (const [name, menu] of MENU)
  for (const showClientAgent of [true, false])
    for (const isAdmin of [false, true]) {
      const key = `${name}|${showClientAgent}|${isAdmin}`;
      const view = connectPageView({ menu, showClientAgent, isAdmin });
      assert.deepEqual(view, EXPECTED[key], `${key}: the decision`);
      for (const l of LOCALES) {
        if (view.kind === "brick") {
          for (const mount of ["none", "empty", "legacy"] as const)
            checkRendered(l, `${l} ${key} ${mount}`, view, isAdmin, render(l, view, false, MOUNTS[mount]), mount);
        } else {
          const out = render(l, view);
          checkRendered(l, `${l} ${key}`, view, isAdmin, out);
          // The closed preview reads nothing of the connectors.
          assert.equal(render(l, view, false, MOUNTS.legacy), out, `${l} ${key}: the preview ignores the connectors`);
        }
      }
      rows++;
    }
assert.equal(rows, Object.keys(EXPECTED).length);
console.log(`ok: ${rows} rows × ${LOCALES.length} locales, every one with a content section`);

// ── 2. Production's switches, through the real menu and switch ──────────────
{
  const PROD_ENV = { CAMPAIGN_DISPATCH: "dry" }; // CLIENT_AGENT and every other switch unset
  const mode = clientAgentMode(PROD_ENV);
  assert.equal(mode, "off");

  // The admin's own page: an admin owns every entry, the brick can't show.
  const adminMenu = menuFor({ entries: ["reception"] }, "admin", null, PROD_ENV);
  assert.deepEqual(adminMenu.connect, { state: "owned" }, "the admin's menu says owned (the case that was empty)");
  const adminView = connectPageView({ menu: adminMenu.connect, showClientAgent: clientAgentEnabled(mode, true), isAdmin: true });
  assert.deepEqual(adminView, { kind: "preview", cta: "soon", notify: false, adminNote: true });
  for (const l of LOCALES) checkRendered(l, `${l} prod admin`, adminView, true, render(l, adminView));

  // A tenant who owns connect through an active trial: closed preview, with "Prévenez-moi".
  const tenantMenu = menuFor({ entries: ["reception", "connect"] }, "user", null, PROD_ENV);
  const tenantView = connectPageView({ menu: tenantMenu.connect, showClientAgent: clientAgentEnabled(mode, false), isAdmin: false });
  assert.deepEqual(tenantView, { kind: "preview", cta: "soon", notify: true, adminNote: false });
  for (const l of LOCALES) checkRendered(l, `${l} prod tenant (trial)`, tenantView, false, render(l, tenantView));
  // Already asked: the line instead of the button, still a full page.
  const asked = render("fr", tenantView, true);
  assert.ok(asked.includes(esc(messages("fr").DashboardNav.previewNotified)) && contentSections("fr", asked).length === 1);

  // Production since T5c: CLIENT_AGENT=admin. The admin's own page is the
  // list (legacy card, or the empty card); a tenant who owns connect keeps
  // the closed preview, unchanged.
  const PROD_NOW = { ...PROD_ENV, CLIENT_AGENT: "admin" };
  const adminMode = clientAgentMode(PROD_NOW);
  assert.equal(adminMode, "admin");
  const adminNowMenu = menuFor({ entries: ["reception"] }, "admin", null, PROD_NOW);
  const adminNow = connectPageView({ menu: adminNowMenu.connect, showClientAgent: clientAgentEnabled(adminMode, true), isAdmin: true });
  assert.deepEqual(adminNow, { kind: "brick" }, "CLIENT_AGENT=admin: the admin gets the list");
  for (const l of LOCALES)
    for (const mount of ["empty", "legacy"] as const)
      checkRendered(l, `${l} prod(admin) admin ${mount}`, adminNow, true, render(l, adminNow, false, MOUNTS[mount]), mount);
  const tenantNowMenu = menuFor({ entries: ["reception", "connect"] }, "user", null, PROD_NOW);
  const tenantNow = connectPageView({ menu: tenantNowMenu.connect, showClientAgent: clientAgentEnabled(adminMode, false), isAdmin: false });
  assert.deepEqual(tenantNow, { kind: "preview", cta: "soon", notify: true, adminNote: false }, "CLIENT_AGENT=admin: a tenant keeps the closed preview");
  for (const l of LOCALES) checkRendered(l, `${l} prod(admin) tenant (trial)`, tenantNow, false, render(l, tenantNow));
  // The admin tenant view of that tenant: the TENANT's switch → the closed preview with the admin line.
  const tenantSeenByAdmin = connectPageView({ menu: tenantNowMenu.connect, showClientAgent: clientAgentEnabled(adminMode, false), isAdmin: true });
  assert.deepEqual(tenantSeenByAdmin, { kind: "preview", cta: "soon", notify: false, adminNote: true });
  for (const l of LOCALES) checkRendered(l, `${l} prod(admin) admin tenant view`, tenantSeenByAdmin, true, render(l, tenantSeenByAdmin, false, null, "u-tenant"));

  // Switch on (CLIENT_AGENT=all): the owned page is the list again.
  const on = clientAgentMode({ ...PROD_ENV, CLIENT_AGENT: "all" });
  const onMenu = menuFor({ entries: ["reception", "connect"] }, "user", null, { ...PROD_ENV, CLIENT_AGENT: "all" });
  assert.deepEqual(connectPageView({ menu: onMenu.connect, showClientAgent: clientAgentEnabled(on, false), isAdmin: false }), { kind: "brick" });
}
console.log("ok: production switches — unset: both closed; admin: the admin's list, the tenant's closed preview");

// ── 3. Source guard ─────────────────────────────────────────────────────────
{
  const page = code("app/[locale]/dashboard/agent/page.tsx");
  assert.match(page, /connectPageView\(\{\s*menu: menu\.connect,\s*showClientAgent: clientAgentEnabled\(clientAgentMode\(\), isAdmin\),\s*isAdmin,\s*\}\)/);
  assert.match(page, /<ConnectPageContent\s/);
  // C1b: the connectors are read on the server, only where the list shows, with the GET's own reader.
  assert.match(page, /const connectors = view\.kind === "brick" \? await loadConnectorsMount\(session\.user\.id\) : null;/);
  assert.match(page, /connectors=\{connectors\}/);
  assert.doesNotMatch(page, /fetch\(|\/api\/dashboard\/connectors/, "no HTTP call to itself");
  assert.doesNotMatch(page, /ConnectOwnedView|state\.state|ProductPreviewHeader/, "the page itself picks nothing");
  const admin = code("app/admin/users/[userId]/agent/page.tsx");
  assert.match(admin, /connectPageView\(\{\s*menu: menu\.connect,\s*showClientAgent: clientAgentEnabled\(clientAgentMode\(\), target\.role === "admin"\),\s*isAdmin: true,\s*\}\)/);
  assert.match(admin, /loadProductPage\(userId\)/, "the TENANT's menu");
  assert.match(admin, /const connectors = view\.kind === "brick" \? await loadConnectorsMount\(userId\) : null;/, "the TENANT's connectors");
  assert.match(admin, /connectors=\{connectors\}/);
  assert.match(admin, /<ConnectPageContent\s[^>]*asUserId=\{userId\}/);
  assert.doesNotMatch(admin, /<ClientAgentBrick/, "no bare brick that hides itself");
  const view = code("app/[locale]/dashboard/agent/connect-view.tsx");
  assert.match(view, /if \(view\.kind === "brick"\)\s*return <ConnectOwnedView [^>]*showClientAgent [^>]*connectors=\{connectors\}/);
  assert.match(view, /notify=\{view\.notify\}/);
}
console.log("ok: both Connect pages decide through connectPageView");

// ── 4. The admin line ───────────────────────────────────────────────────────
{
  assert.equal(messages("fr").DashboardNav.connectAdminClosed, "Admin : la carte « Votre agent IA » s'affiche quand le produit est ouvert pour ce compte.");
  for (const l of LOCALES) {
    const s: string = messages(l).DashboardNav.connectAdminClosed;
    assert.ok(s && s.includes(messages(l).ClientAgentBrick.title), `${l}: names the card by its own title`);
    assert.doesNotMatch(s, /CLIENT_AGENT|PRODUCT_ORDERS|CAMPAIGN|env|flag|\b[A-Z]{3,}_[A-Z_]+\b/, `${l}: no flag or env name`);
  }
  assert.doesNotMatch(messages("he").DashboardNav.connectAdminClosed, /תמרה/, "he: Tamara in Latin");
}
console.log("ok: the admin line in fr/en/he");

console.log("connect-page-view: OK");
