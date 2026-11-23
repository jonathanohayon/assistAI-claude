// A setup step never sends a customer to an offer they already have (F2,
// 23/11). The checklist's product steps ("import contacts" = Sales, "paste
// your agent's address" = Connect) read the MENU's decision (lib/product-
// menu.ts, the sidebar's rule) through the header's own rule (lib/trial-cta.ts),
// never a plan feature: a premium sales-door tenant saw "Inclus dans le plan
// Clinique / Multi-sites — Voir l'offre", its own plan, because the step read
// canUseOutboundCampaigns, which no plan grants any more.
// Mock data only. Run with:  npx tsx scripts/tests/checklist-follows-menu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SetupChecklist } from "../../components/dashboard/SetupChecklist";
import { connectStepView, productStepView, type ProductStepView } from "../../components/dashboard/setup-checklist-ui";
import type { Door } from "../../lib/door-values";
import { DEFAULT_MATRIX, featuresForPlan } from "../../lib/plan-features";
import { entitledProducts } from "../../lib/product-entitlement";
import { menuFor } from "../../lib/product-gates";
import type { ProductEntryState } from "../../lib/product-menu";
import { clientAgentEnabled, clientAgentMode } from "../../lib/tools/client-agent-switch";
import type { TrialCtaTrial } from "../../lib/trial-cta";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1. The step's decision, from the menu state and the trial ───────────────
const OWNED: ProductEntryState = { state: "owned" };
const SOON: ProductEntryState = { state: "preview", cta: "soon" };
const TRY: ProductEntryState = { state: "preview", cta: "try" };
const T = {
  none: undefined as TrialCtaTrial,
  startable: { state: "available", startable: true } as TrialCtaTrial,
  notStartable: { state: "available" } as TrialCtaTrial,
  used: { state: "used" } as TrialCtaTrial,
  active: { state: "active", endsAt: "2026-12-01T00:00:00.000Z" } as TrialCtaTrial,
};
const STEP_TABLE: Array<[ProductEntryState, keyof typeof T, ProductStepView]> = [
  [OWNED, "none", "open"],
  [OWNED, "startable", "open"],
  [OWNED, "used", "open"],
  [OWNED, "active", "open"],
  [SOON, "none", "soon"],
  [SOON, "startable", "soon"],
  [SOON, "used", "soon"],
  [SOON, "active", "soon"],
  [TRY, "startable", "try"],
  [TRY, "none", "offer"],
  [TRY, "notStartable", "offer"],
  [TRY, "used", "offer"],
  [TRY, "active", "open"],
];
for (const [entry, trial, want] of STEP_TABLE)
  assert.equal(productStepView(entry, T[trial]), want, `${JSON.stringify(entry)} + ${trial} → ${want}`);

// Connect: the Connect page's own decision (owned but the brick can't show → soon).
assert.equal(connectStepView({ menu: OWNED, showClientAgent: true, isAdmin: false, trial: T.none }), "open");
assert.equal(connectStepView({ menu: OWNED, showClientAgent: false, isAdmin: true, trial: T.none }), "soon");
assert.equal(connectStepView({ menu: SOON, showClientAgent: false, isAdmin: false, trial: T.none }), "soon");
assert.equal(connectStepView({ menu: TRY, showClientAgent: true, isAdmin: false, trial: T.startable }), "try");
assert.equal(connectStepView({ menu: TRY, showClientAgent: true, isAdmin: false, trial: T.used }), "offer");
console.log("ok: step decision table");

// ── 2. Door × account × switches × trial, rendered ─────────────────────────
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const MESSAGES = Object.fromEntries(["fr", "en", "he"].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]));
type Props = Parameters<typeof SetupChecklist>[0];
const render = (locale: string, props: Props) =>
  renderToStaticMarkup(createElement(Intl, { locale, messages: MESSAGES[locale], timeZone: "UTC" }, createElement(SetupChecklist, props)));
const BASE = { hasPhone: false, googleConnected: false, businessFilled: false, whatsappSet: false };
// Text as React renders it (an apostrophe is &#x27;): a raw "Voir l'offre" would never match.
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const has = (html: string, text: string) => html.includes(esc(text));
assert.ok(has("<a>Voir l&#x27;offre</a>", "Voir l'offre") && !"<a>Voir l&#x27;offre</a>".includes("Voir l'offre"), "probe: escaped apostrophe");
assert.ok(has(render("fr", BASE), MESSAGES.fr.DashboardSetup.forwardingDesc), "probe: has() finds rendered text with an apostrophe-free line");
assert.ok(has(render("fr", BASE), MESSAGES.fr.DashboardSetup.testCallDesc) && MESSAGES.fr.DashboardSetup.testCallDesc.includes("'"), "probe: has() finds a line with an apostrophe");

// What config-page.tsx passes, from a menu built exactly as the server builds it.
function checklistProps(door: Door, plan: string, role: string, env: Record<string, string>, trial: TrialCtaTrial, outbound = false): { props: Props; entitled: string[] } {
  const entitlement = entitledProducts({ subscriptionPlan: plan, subscriptionStatus: "active", products: null });
  const features = { ...featuresForPlan(DEFAULT_MATRIX, plan), outbound_campaigns: outbound };
  const menu = menuFor(entitlement, role, features, env);
  const isAdmin = role === "admin";
  return {
    entitled: isAdmin ? ["reception", "sales", "connect"] : entitlement.entries,
    props: {
      ...BASE,
      door,
      contacts: door === "sales" ? { done: false, view: productStepView(menu.sales, trial) } : undefined,
      liveTest: door === "sales" ? { done: false } : undefined,
      clientAgent:
        door === "connect"
          ? { done: false, view: connectStepView({ menu: menu.connect, showClientAgent: clientAgentEnabled(clientAgentMode(env), isAdmin), isAdmin, trial }) }
          : undefined,
    },
  };
}

const ENVS: Record<string, string>[] = [{}, { CAMPAIGN_DISPATCH: "dry" }, { CAMPAIGN_DISPATCH: "on" }, { CLIENT_AGENT: "all" }, { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }];
let rows = 0;
const seen = new Set<string>();
for (const door of ["sales", "connect", "reception"] as Door[])
  for (const plan of ["premium", "global", "whatsapp"])
    for (const role of ["user", "admin"])
      for (const env of ENVS)
        for (const outbound of [false, true])
          for (const [tk, trial] of Object.entries(T)) {
            const { props, entitled } = checklistProps(door, plan, role, env, trial, outbound);
            const entry = door === "sales" ? "sales" : door === "connect" ? "connect" : null;
            const step = door === "sales" ? props.contacts : door === "connect" ? props.clientAgent : undefined;
            for (const locale of ["fr", "en", "he"]) {
              const m = MESSAGES[locale];
              const html = render(locale, props);
              const label = `${locale} door=${door} plan=${plan} role=${role} env=${JSON.stringify(env)} outbound=${outbound} trial=${tk}`;
              // No step ever names a plan.
              assert.ok(!has(html, m.Plans.premium.name), `${label}: no plan name`);
              if (entry && entitled.includes(entry)) assert.ok(!has(html, m.DashboardNav.previewOffer), `${label}: entitled → no offer`);
              if (!entry) {
                assert.ok(!has(html, m.DashboardSetup.contactsTitle) && !has(html, m.DashboardSetup.clientAgentTitle), `${label}: no product step`);
                assert.ok(!has(html, m.DashboardNav.previewOffer), `${label}: no offer`);
              }
              if (step?.view === "soon") {
                assert.match(html, /data-step-soon=""/, `${label}: soon label`);
                assert.ok(!has(html, m.DashboardNav.previewOffer) && !has(html, m.DashboardNav.previewTry), `${label}: soon is never an offer`);
              }
              if (step?.view === "open") assert.ok(!has(html, m.DashboardNav.previewOffer), `${label}: open → no offer`);
              rows++;
            }
            if (entry) seen.add(`${entry}:${step?.view}`);
          }
assert.ok(rows > 1000, `rows checked: ${rows}`);
// The table reaches every view of both product steps (else a check above is vacuous).
assert.deepEqual([...seen].sort(), ["connect:offer", "connect:open", "connect:soon", "connect:try", "sales:offer", "sales:open", "sales:soon", "sales:try"]);
console.log(`ok: ${rows} door × account × switch × trial rows`);

// ── 3. The finding: a premium sales-door tenant, switches as in prod ───────
for (const env of [{}, { CAMPAIGN_DISPATCH: "dry" }] as Record<string, string>[]) {
  const { props } = checklistProps("sales", "premium", "user", env, undefined);
  assert.equal(props.contacts?.view, "soon", "premium sales door: Sales is 'Bientôt' in the menu, so is the step");
  for (const locale of ["fr", "en", "he"]) {
    const m = MESSAGES[locale];
    const html = render(locale, props);
    assert.ok(has(html, m.DashboardSetup.contactsTitle), `${locale}: the step is listed`);
    assert.ok(!has(html, m.Plans.premium.name), `${locale}: not "Inclus dans le plan ${m.Plans.premium.name}"`);
    assert.ok(!has(html, m.DashboardNav.previewOffer), `${locale}: no "${m.DashboardNav.previewOffer}"`);
    assert.ok(!html.includes("/dashboard/sales"), `${locale}: no link to the sales page from the checklist`);
    assert.match(html, new RegExp(`data-step-soon=""[^>]*>${m.DashboardNav.stateSoon}<`), `${locale}: the sidebar's "${m.DashboardNav.stateSoon}"`);
    // Not counted: 1 live test + 6 reception steps.
    assert.ok(html.includes(m.DashboardSetup.progress.replace("{done}", "0").replace("{total}", "7")), `${locale}: 0/7, the soon step not counted`);
  }
}
// Owned (an admin's own dashboard): today's action, counted.
{
  const { props } = checklistProps("sales", "premium", "admin", {}, undefined);
  const html = render("fr", props);
  assert.equal(props.contacts?.view, "open");
  assert.ok(has(html, MESSAGES.fr.DashboardSetup.contactsCta) && html.includes('href="/fr/dashboard/sales"'));
  assert.ok(html.includes(MESSAGES.fr.DashboardSetup.progress.replace("{done}", "0").replace("{total}", "8")));
}
// try + startable: the header's "Essayer gratuitement", to the product page.
{
  const html = render("fr", { ...BASE, door: "sales", contacts: { done: false, view: "try" }, liveTest: { done: false } });
  assert.ok(has(html, MESSAGES.fr.DashboardNav.previewTry) && html.includes('href="/fr/dashboard/sales"'));
  const offer = render("fr", { ...BASE, door: "connect", clientAgent: { done: false, view: "offer" } });
  assert.ok(has(offer, MESSAGES.fr.DashboardNav.previewOffer) && offer.includes('href="/fr/dashboard/agent"'));
}
console.log("ok: the premium sales-door case");

// ── 4. Source guards: the checklist reads the menu, not a plan feature ─────
{
  const page = code("app/[locale]/dashboard/config/config-page.tsx");
  assert.doesNotMatch(page, /canUseOutboundCampaigns/, "config-page: no plan-feature gate for the steps");
  assert.match(page, /view: productStepView\(products\.menu\.sales, products\.trials\.sales\)/);
  assert.match(page, /view: connectStepView\(\{ menu: products\.menu\.connect, showClientAgent: clientAgentVisible, isAdmin, trial: products\.trials\.connect \}\)/);
  assert.doesNotMatch(page, /accountProducts|loadProductPage|accountProductNav|menuFor/, "config-page: no second read, the page passes it");
  const reception = code("app/[locale]/dashboard/reception/page.tsx");
  assert.match(reception, /const \{ menu, notifyRequested, trials, trialTerms \} = await loadProductPage\(session\.user\.id\);/);
  assert.match(reception, /<TenantConfigPage locale=\{locale\} section="reception" products=\{\{ menu, trials \}\} \/>/);
  const checklist = code("components/dashboard/SetupChecklist.tsx");
  assert.doesNotMatch(checklist, /canUseOutboundCampaigns|outboundPlanName|useTranslations\("Plans"\)|locked:\s*contacts|tile=campaigns/, "checklist: no plan, no upsell tile");
  const ui = code("components/dashboard/setup-checklist-ui.ts");
  assert.match(ui, /trialCta\(entry, trial\)/, "the header's rule");
  assert.match(ui, /connectPageView\(input\)/, "the Connect page's rule");
}
console.log("ok: source guards");

console.log("checklist-follows-menu: OK");
