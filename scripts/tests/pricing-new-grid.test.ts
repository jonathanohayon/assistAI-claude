// The public pricing section on the product grid (F3a,
// components/marketing/Pricing.tsx + lib/pricing-grid.ts):
//   1. every number on a card comes from the catalogue it is given (an edited
//      catalogue moves the render), in EUR and ILS, monthly and annual;
//   2. annual = 10 × monthly is what the default catalogue displays;
//   3. reception_multi shows no add-on price;
//   4. every CTA is sign-up through the product's door, never a checkout,
//      billing or plan path, with or without prices;
//   5. the client fetch reads `products` strictly; the locale currency;
//   6. the section no longer reads the old plans nor any default amount.
// Mock data only — no network, no DB.
// Run with:  npx tsx scripts/tests/pricing-new-grid.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Pricing, ProductPricingGrid } from "../../components/marketing/Pricing";
import { landingCurrencyFor } from "../../lib/landing-currency";
import { CONNECT_SIGNUP_HREF } from "../../lib/marketing/landings/connect";
import { SALES_SIGNUP_HREF } from "../../lib/marketing/landings/sales";
import {
  catalogueCurrencyOf,
  fetchPublicProducts,
  formatGridMoney,
  formatGridPerMinute,
  GRID_PRODUCTS,
  GRID_SIGNUP_HREF,
  inSignupTrial,
  SIGNUP_TRIAL,
  type Billing,
} from "../../lib/pricing-grid";
import { DEFAULT_PRODUCT_CATALOGUE, type CatalogueCurrency, type ProductCatalogue } from "../../lib/product-catalogue";
import { entitledProducts } from "../../lib/product-entitlement";
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "../../lib/product-trials";
import { entryOf, type Product } from "../../lib/product-values";
import { TRIAL_PLAN_KEY } from "../../lib/plans";
import { TRIAL_DURATION_MS, TRIAL_MINUTES_INCLUDED } from "../../lib/trial";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const html = (locale: string, el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(Intl, { locale, messages: messages(locale), timeZone: "UTC" }, el));
const grid = (locale: string, catalogue: ProductCatalogue | null, currency: CatalogueCurrency, billing: Billing) =>
  html(locale, createElement(ProductPricingGrid, { catalogue, currency, billing }));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The markup of one product's card. */
function card(markup: string, p: Product): string {
  const start = markup.indexOf(`data-product="${p}"`);
  assert.ok(start >= 0, `card ${p} rendered`);
  const end = markup.indexOf("</article>", start);
  return markup.slice(start, end);
}
/** The text of a data-* line in a card (tags stripped). */
function line(cardHtml: string, attr: string): string {
  const m = cardHtml.match(new RegExp(`${attr}=""[^>]*>([\\s\\S]*?)</(?:li|span)>`));
  assert.ok(m, `${attr} line`);
  return m[1].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
}
const norm = (s: string) => s.replace(/[  ‎‏]/g, " ");

async function main() {
  // ── 1. Numbers follow the catalogue, EUR and ILS, monthly and annual ──────
  const EDITED: ProductCatalogue = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
  EDITED.sales.EUR.monthly = 151;
  EDITED.sales.EUR.annual = 1517;
  EDITED.sales.EUR.minutes = 433;
  EDITED.sales.EUR.overagePerMin = 0.47;
  EDITED.sales.EUR.addonMonthly = 97;
  EDITED.sales.EUR.addonAnnual = 977;
  EDITED.connect.ILS.monthly = 213;
  EDITED.connect.ILS.minutes = 111;
  for (const l of LOCALES) {
    for (const currency of ["EUR", "ILS"] as const) {
      for (const billing of ["monthly", "annual"] as const) {
        for (const cat of [DEFAULT_PRODUCT_CATALOGUE, EDITED]) {
          const out = grid(l, cat, currency, billing);
          assert.doesNotMatch(out, /grid-price-placeholder/, "no placeholder once the catalogue is there");
          for (const p of GRID_PRODUCTS) {
            const row = cat[p][currency];
            const c = card(out, p);
            const price = billing === "annual" ? row.annual : row.monthly;
            assert.equal(norm(line(c, "data-price")), norm(formatGridMoney(price, currency, l)), `${l} ${currency} ${billing} ${p} price`);
            assert.ok(norm(line(c, "data-minutes")).includes(String(row.minutes)), `${l} ${p} minutes`);
            assert.ok(norm(line(c, "data-overage")).includes(norm(formatGridPerMinute(row.overagePerMin, currency, l))), `${l} ${p} overage`);
            const addon = billing === "annual" ? row.addonAnnual : row.addonMonthly;
            if (addon !== null) assert.ok(norm(line(c, "data-addon")).includes(norm(formatGridMoney(addon, currency, l))), `${l} ${p} add-on`);
          }
        }
      }
    }
  }
  // The edit itself shows up (and the default does not).
  const fr = norm(card(grid("fr", EDITED, "EUR", "monthly"), "sales"));
  assert.match(fr, /151 €/);
  assert.match(fr, /433 minutes/);
  assert.match(fr, /0,47 €/);
  assert.match(fr, /\+ 97 € \/ mois/);
  assert.doesNotMatch(fr, /149 €|400 minutes/);
  assert.match(norm(card(grid("fr", EDITED, "EUR", "annual"), "sales")), /1 517 €/, "annual is read from the catalogue's annual field");
  assert.match(norm(card(grid("he", EDITED, "ILS", "monthly"), "connect")), /213\s+₪/);

  // ── 2. Annual = 10 × monthly on the default catalogue, in both currencies ──
  for (const currency of ["EUR", "ILS"] as const) {
    for (const p of GRID_PRODUCTS) {
      const row = DEFAULT_PRODUCT_CATALOGUE[p][currency];
      assert.equal(row.annual, row.monthly * 10, `${p} ${currency}: catalogue annual = 10 × monthly`);
      const shown = norm(line(card(grid("fr", DEFAULT_PRODUCT_CATALOGUE, currency, "annual"), p), "data-price"));
      assert.equal(shown, norm(formatGridMoney(row.monthly * 10, currency, "fr")), `${p} ${currency}: annual shown = 10 × monthly`);
    }
  }
  assert.match(norm(card(grid("fr", DEFAULT_PRODUCT_CATALOGUE, "EUR", "annual"), "reception")), /890 €[\s\S]*TTC \/ an[\s\S]*2 mois offerts/);
  assert.match(norm(card(grid("fr", DEFAULT_PRODUCT_CATALOGUE, "ILS", "monthly"), "sales")), /549 ₪[\s\S]*250 minutes[\s\S]*1,90 ₪/, "ILS sales: 250 min, 1.90 ₪ (differs from EUR on purpose)");
  assert.match(norm(card(grid("fr", DEFAULT_PRODUCT_CATALOGUE, "EUR", "monthly"), "sales")), /149 €[\s\S]*400 minutes[\s\S]*0,39 €/);

  // ── 3. reception_multi: never an add-on price ─────────────────────────────
  for (const l of LOCALES) {
    const m = messages(l).Pricing.grid;
    for (const currency of ["EUR", "ILS"] as const) {
      for (const billing of ["monthly", "annual"] as const) {
        const multi = card(grid(l, DEFAULT_PRODUCT_CATALOGUE, currency, billing), "reception_multi");
        assert.equal(line(multi, "data-addon"), m.baseOnly, `${l} ${currency} ${billing}: multi-site says "base only"`);
        assert.doesNotMatch(multi, /\+/, `${l}: no "+ price" on multi-site`);
        for (const p of ["reception", "sales", "connect"] as const) {
          assert.notEqual(line(card(grid(l, DEFAULT_PRODUCT_CATALOGUE, currency, billing), p), "data-addon"), m.baseOnly, `${l} ${p} has an add-on price`);
        }
      }
    }
  }

  // ── 4. Every CTA: sign-up through the door, nothing that can buy ─────────
  assert.deepEqual(GRID_SIGNUP_HREF, {
    reception: "/signup",
    reception_multi: "/signup",
    sales: SALES_SIGNUP_HREF,
    connect: CONNECT_SIGNUP_HREF,
  });
  for (const l of LOCALES) {
    for (const cat of [null, DEFAULT_PRODUCT_CATALOGUE]) {
      for (const billing of ["monthly", "annual"] as const) {
        const out = cat === null ? html(l, createElement(Pricing)) : grid(l, cat, "EUR", billing);
        const hrefs = [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        assert.equal(hrefs.length, GRID_PRODUCTS.length, `${l}: exactly one link per card, nothing else`);
        for (const h of hrefs) {
          assert.match(h, /^(\/(fr|en|he))?\/signup(\?door=(sales|connect))?$/, `${l}: ${h} is sign-up`);
          assert.doesNotMatch(h, /billing|checkout|plan=|pay|order/i, `${l}: ${h} cannot buy`);
        }
        for (const p of GRID_PRODUCTS) {
          const c = card(out, p);
          const h = c.match(/href="([^"]*)"/)![1];
          assert.ok(h.endsWith(GRID_SIGNUP_HREF[p]), `${l} ${p}: ${h}`);
          const g = messages(l).Pricing.grid;
          const aria = inSignupTrial(p) ? g.ctaAria : g.ctaAccountAria;
          assert.match(c, new RegExp(`aria-label="${esc(aria.replace("{name}", g.products[p].name))}"`));
        }
      }
    }
  }

  // ── 4b. The trial wording is TODAY's sign-up trial (lib/trial.ts) ─────────
  // The source of truth: the sign-up trial's length and minutes, and the
  // products a trialing account is entitled to (Réception only, today).
  assert.deepEqual(SIGNUP_TRIAL, { days: TRIAL_DURATION_MS / 86_400_000, minutes: TRIAL_MINUTES_INCLUDED });
  const trialEntries = entitledProducts({ subscriptionPlan: TRIAL_PLAN_KEY, subscriptionStatus: "trialing", products: null }).entries;
  for (const p of GRID_PRODUCTS) assert.equal(inSignupTrial(p), trialEntries.includes(entryOf(p)), `${p}: in the trial = what a trialing account gets`);
  assert.deepEqual(GRID_PRODUCTS.filter(inSignupTrial), ["reception", "reception_multi"], "today: Réception (single and multi-site)");
  for (const l of LOCALES) {
    const m = messages(l);
    const fmt = (key: string) =>
      (createTranslator({ locale: l, messages: m, namespace: "Pricing" }) as unknown as (k: string, v: object) => string)(key, SIGNUP_TRIAL);
    // One source: the copy takes the numbers as arguments, never writes them.
    for (const s of [m.Pricing.trial, m.Pricing.grid.cardTrial]) {
      assert.ok(s.includes("{days}") && s.includes("{minutes}"), `${l}: "${s}" reads the numbers from lib/trial.ts`);
      assert.doesNotMatch(s.replace(/\{\w+\}/g, ""), /\d/, `${l}: no number written in "${s}"`);
    }
    const page = html(l, createElement(Pricing));
    const banner = page.match(/data-trial-banner=""[^>]*>([\s\S]*?)<\/p>/)![1].replace(/<[^>]+>/g, "");
    assert.equal(banner, esc(fmt("trial")), `${l}: the banner says today's trial`);
    assert.ok(banner.includes(String(SIGNUP_TRIAL.days)) && banner.includes(String(SIGNUP_TRIAL.minutes)), `${l}: banner numbers`);
    for (const p of GRID_PRODUCTS) {
      const c = card(page, p);
      const trialLine = c.match(/data-trial-line=""[^>]*>([\s\S]*?)<\/p>/)![1];
      const cta = c.match(/data-cta="[^"]+"[^>]*>([\s\S]*?)<\/a>/)![1];
      if (inSignupTrial(p)) {
        assert.equal(trialLine, esc(fmt("grid.cardTrial")), `${l} ${p}: today's trial`);
        assert.equal(cta, esc(m.Pricing.grid.cta));
      } else {
        assert.equal(trialLine, esc(m.Pricing.grid.notInTrial), `${l} ${p}: not in the trial`);
        assert.equal(cta, esc(m.Pricing.grid.ctaAccount), `${l} ${p}: neutral CTA`);
        assert.ok(!c.includes(esc(m.Pricing.grid.cta)) && !c.includes(esc(fmt("grid.cardTrial"))), `${l} ${p}: no free-trial promise`);
      }
    }
    // F4's per-product trial (7 days + 30 minutes) is promised nowhere yet.
    for (const s of Object.values(m.Pricing.grid).concat(m.Pricing.trial).filter((x): x is string => typeof x === "string"))
      assert.ok(!s.includes(String(PRODUCT_TRIAL_DAYS)) || PRODUCT_TRIAL_DAYS === SIGNUP_TRIAL.days, `${l}: no ${PRODUCT_TRIAL_DAYS}-day promise in "${s}"`);
    assert.doesNotMatch(page.replace(/<[^>]+>/g, " "), new RegExp(`(?<!\\d)${PRODUCT_TRIAL_MINUTES}(?!\\d)`), `${l}: no ${PRODUCT_TRIAL_MINUTES}-minute promise`);
  }
  // No form, no button that posts: the only buttons are the toggle and the currency.
  const full = html("fr", createElement(Pricing));
  assert.doesNotMatch(full, /<form|action=|formaction/i);
  const buttons = [...full.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.ok(buttons.every((b) => /data-billing=|data-currency-button=/.test(b)), "only the period toggle and the currency button");

  // ── 5. Fetch (strict) and the locale currency ─────────────────────────────
  const body = { global: {}, products: EDITED };
  assert.deepEqual(await fetchPublicProducts((async () => Response.json(body)) as typeof fetch), EDITED);
  assert.equal(await fetchPublicProducts((async () => Response.json({ global: {} })) as typeof fetch), null, "no products field");
  const bad = structuredClone(EDITED) as unknown as Record<string, Record<string, Record<string, unknown>>>;
  bad.reception_multi.EUR.addonMonthly = 50;
  assert.equal(await fetchPublicProducts((async () => Response.json({ products: bad })) as typeof fetch), null, "multi-site add-on refused");
  assert.equal(await fetchPublicProducts((async () => Response.json({ error: "x" }, { status: 503 })) as typeof fetch), null);
  assert.equal(await fetchPublicProducts((async () => { throw new TypeError("offline"); }) as typeof fetch), null);
  assert.equal(catalogueCurrencyOf(landingCurrencyFor("fr")), "ILS");
  assert.equal(catalogueCurrencyOf(landingCurrencyFor("he")), "ILS");
  assert.equal(catalogueCurrencyOf(landingCurrencyFor("en")), "EUR", "USD is not in the catalogue → EUR");
  assert.equal(catalogueCurrencyOf("EUR"), "EUR");
  // The section opens in that currency (the dropdown shows it).
  assert.match(html("he", createElement(Pricing)), /data-currency-button=""[\s\S]*?>ILS</);
  assert.match(html("en", createElement(Pricing)), /data-currency-button=""[\s\S]*?>EUR</);

  // ── 6. Source: no old plans, no default amounts, product names match the menu ─
  const src = read("components/marketing/Pricing.tsx").replace(/^\s*\/\/.*$/gm, ""); // code only, not comments
  assert.doesNotMatch(src, /lib\/plans|PUBLIC_PLANS|PlanCard|PricingComparison|DEFAULT_PRODUCT_CATALOGUE|DEFAULT_PLAN_PRICING|\/billing|checkout/);
  assert.doesNotMatch(read("lib/pricing-grid.ts").replace(/^\s*\/\/.*$/gm, ""), /DEFAULT_PRODUCT_CATALOGUE|lib\/db/);
  for (const l of LOCALES) {
    const m = messages(l);
    for (const p of ["reception", "sales", "connect"] as const) assert.equal(m.Pricing.grid.products[p].name, m.DashboardNav[p], `${l}: ${p} named as in the menu`);
    assert.ok(m.Pricing.how && m.Pricing.howLabel, `${l}: the how-it-works line`);
  }

  console.log("ALL PRICING-NEW-GRID TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
