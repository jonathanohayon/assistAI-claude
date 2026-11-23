// "Connecter votre agent" can never be empty (P1, 23/11): with CLIENT_AGENT
// unset (as in production) an admin owns every entry, the brick was hidden,
// and the page was a title and nothing else.
//   1. The table: menu state × showClientAgent × isAdmin → lib/connect-page-view.ts,
//      and EVERY row renders at least one content section (the brick, or the
//      closed product's header sentence + the sample brick), in fr/en/he.
//      Admin rows: the admin line, no "Prévenez-moi"; tenant "soon" rows: the
//      button, no admin line.
//   2. Production's switches (CLIENT_AGENT unset, CAMPAIGN_DISPATCH=dry): the
//      admin's own page and a tenant who owns connect through an active trial,
//      from the real menu (menuFor) and the real switch (clientAgentMode).
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

/** The page's content sections in `out`: the live brick (mounted, loading) or the sample brick. */
function contentSections(l: string, out: string): string[] {
  const m = messages(l);
  const found: string[] = [];
  if (out.includes(`aria-busy="true">${esc(m.ToolsBrick.loading)}</p>`)) found.push("brick");
  if (out.includes('id="client-agent"') && out.includes(esc(m.DashboardNav.pitchConnect))) found.push("closed preview");
  return found;
}

function render(l: string, view: ConnectPageView, notifyRequested = false): string {
  return html(
    l,
    createElement(ConnectPageContent, {
      view,
      title: messages(l).DashboardNav.connect,
      trialNote: null,
      notifyRequested,
      trial: undefined,
      trialTerms: TERMS,
    }),
  );
}

function checkRendered(l: string, who: string, view: ConnectPageView, isAdmin: boolean, out: string) {
  const m = messages(l).DashboardNav;
  assert.ok(out.includes(`${esc(m.connect)}</h1>`), `${who}: the title`);
  const sections = contentSections(l, out);
  assert.ok(sections.length >= 1, `${who}: at least one content section (got none)`);
  assert.equal(sections.length, 1, `${who}: one view, not both (${sections.join(", ")})`);
  const adminLine = out.includes(esc(m.connectAdminClosed));
  const notifyButton = out.includes(`>${esc(m.previewNotify)}</button>`);
  if (view.kind === "brick") {
    assert.deepEqual(sections, ["brick"], `${who}: the brick`);
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
      for (const l of LOCALES) checkRendered(l, `${l} ${key}`, view, isAdmin, render(l, view));
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

  // Switch on (CLIENT_AGENT=all): the owned page is the brick again.
  const on = clientAgentMode({ ...PROD_ENV, CLIENT_AGENT: "all" });
  const onMenu = menuFor({ entries: ["reception", "connect"] }, "user", null, { ...PROD_ENV, CLIENT_AGENT: "all" });
  assert.deepEqual(connectPageView({ menu: onMenu.connect, showClientAgent: clientAgentEnabled(on, false), isAdmin: false }), { kind: "brick" });
}
console.log("ok: production switches — admin and trial tenant both get the closed preview");

// ── 3. Source guard ─────────────────────────────────────────────────────────
{
  const page = code("app/[locale]/dashboard/agent/page.tsx");
  assert.match(page, /connectPageView\(\{\s*menu: menu\.connect,\s*showClientAgent: clientAgentEnabled\(clientAgentMode\(\), isAdmin\),\s*isAdmin,\s*\}\)/);
  assert.match(page, /<ConnectPageContent\s/);
  assert.doesNotMatch(page, /ConnectOwnedView|state\.state|ProductPreviewHeader/, "the page itself picks nothing");
  const admin = code("app/admin/users/[userId]/agent/page.tsx");
  assert.match(admin, /connectPageView\(\{\s*menu: menu\.connect,\s*showClientAgent: clientAgentEnabled\(clientAgentMode\(\), target\.role === "admin"\),\s*isAdmin: true,\s*\}\)/);
  assert.match(admin, /loadProductPage\(userId\)/, "the TENANT's menu");
  assert.match(admin, /<ConnectPageContent [^>]*asUserId=\{userId\}/);
  assert.doesNotMatch(admin, /<ClientAgentBrick/, "no bare brick that hides itself");
  const view = code("app/[locale]/dashboard/agent/connect-view.tsx");
  assert.match(view, /if \(view\.kind === "brick"\) return <ConnectOwnedView [^>]*showClientAgent /);
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
