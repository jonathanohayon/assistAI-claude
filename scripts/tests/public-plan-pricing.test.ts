// The landing is prerendered, so plan prices come from
// GET /api/public/plan-pricing on the client. These tests pin the contract:
// the API returns the admin grid, a failure is an uncached 503 with no price,
// the client turns any failure into "no price", and the server-rendered
// pricing section (what the static HTML contains) shows placeholders and no
// default amount.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Pricing } from "../../components/marketing/Pricing";
import { PlanCard, useExchangeRates } from "../../components/plans/PlanCard";
import { DEFAULT_PLAN_PRICING, PRICE_FIELDS, type PlanPricingMap } from "../../lib/plan-pricing";
import { PUBLIC_PLANS } from "../../lib/plans";
import {
  PUBLIC_PLAN_PRICING_CACHE_CONTROL,
  PUBLIC_PLAN_PRICING_PATH,
  fetchPublicPlanPricing,
  parsePublicPlanPricing,
  publicPlanPricingResponse,
} from "../../lib/public-plan-pricing";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

// A grid that differs from the defaults everywhere, as an admin edit would.
const EDITED: PlanPricingMap = JSON.parse(JSON.stringify(DEFAULT_PLAN_PRICING));
for (const k of Object.keys(EDITED) as (keyof PlanPricingMap)[]) {
  for (const f of PRICE_FIELDS) EDITED[k][f] = EDITED[k][f] + 7;
}

// Every amount the defaults could put on a public card: the four stored
// amounts and the monthly equivalent of the annual totals.
const DEFAULT_AMOUNTS = PUBLIC_PLANS.flatMap((p) => {
  const row = DEFAULT_PLAN_PRICING[p.key];
  return [row.eurMonthly, row.eurAnnual, row.ilsMonthly, row.ilsAnnual, Math.round(row.eurAnnual / 12), Math.round(row.ilsAnnual / 12)];
});
// Matches the number as a whole, also with a thousands separator (3 490, 3,490).
const amountRe = (n: number) => {
  const s = String(n);
  const grouped = s.length > 3 ? `${s.slice(0, -3)}[\\s,.\\u00a0\\u202f]?${s.slice(-3)}` : s;
  return new RegExp(`(?<![\\d.,])${grouped}(?![\\d])`);
};

function renderWithIntl(locale: string, node: React.ReactElement) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, node),
  );
}

// tsx compiles these scripts to CJS: no top-level await.
async function main() {
  console.log("public-plan-pricing");

  await test("the API returns the grid with a short public cache", async () => {
    const res = await publicPlanPricingResponse(async () => EDITED);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), PUBLIC_PLAN_PRICING_CACHE_CONTROL);
    assert.match(PUBLIC_PLAN_PRICING_CACHE_CONTROL, /s-maxage=60/);
    assert.match(PUBLIC_PLAN_PRICING_CACHE_CONTROL, /stale-while-revalidate=/);
    assert.deepEqual(await res.json(), EDITED);
  });

  await test("the route serves getPlanPricingMap through that response", () => {
    const route = read("app/api/public/plan-pricing/route.ts");
    assert.match(route, /publicPlanPricingResponse\(getPlanPricingMap\)/);
    assert.equal(PUBLIC_PLAN_PRICING_PATH, "/api/public/plan-pricing");
  });

  await test("a failed load is an uncached 503 without any price", async () => {
    const res = await publicPlanPricingResponse(async () => {
      throw new Error("db down");
    });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = JSON.stringify(await res.json());
    for (const n of DEFAULT_AMOUNTS) assert.doesNotMatch(body, amountRe(n));
  });

  await test("parse is strict: a partial grid is rejected, never filled from defaults", () => {
    assert.deepEqual(parsePublicPlanPricing(EDITED), EDITED);
    const partial = JSON.parse(JSON.stringify(EDITED));
    delete partial.global.ilsMonthly;
    assert.equal(parsePublicPlanPricing(partial), null);
    assert.equal(parsePublicPlanPricing({ ...EDITED, premium: { ...EDITED.premium, eurMonthly: -1 } }), null);
    assert.equal(parsePublicPlanPricing(null), null);
    assert.equal(parsePublicPlanPricing("nope"), null);
  });

  await test("client fetch: ok → grid; error status, bad JSON or network error → null", async () => {
    const ok = (async () => Response.json(EDITED)) as typeof fetch;
    assert.deepEqual(await fetchPublicPlanPricing(ok), EDITED);
    const err503 = (async () => Response.json({ error: "x" }, { status: 503 })) as typeof fetch;
    assert.equal(await fetchPublicPlanPricing(err503), null);
    const badJson = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    assert.equal(await fetchPublicPlanPricing(badJson), null);
    const offline = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    assert.equal(await fetchPublicPlanPricing(offline), null);
  });

  for (const locale of LOCALES) {
    await test(`${locale}: the prerendered pricing section shows placeholders and no default amount`, () => {
      const html = renderWithIntl(locale, createElement(Pricing));
      assert.equal(html.match(/data-testid="plan-price-placeholder"/g)?.length, PUBLIC_PLANS.length);
      for (const n of DEFAULT_AMOUNTS) assert.doesNotMatch(html, amountRe(n), `default amount ${n} in the HTML`);
    });
  }

  await test("control: a card given the grid does render its amount (the check above can fail)", () => {
    function Card() {
      const rates = useExchangeRates();
      return createElement(PlanCard, {
        plan: PUBLIC_PLANS[0],
        billing: "monthly",
        currency: "ILS",
        rates,
        pricing: DEFAULT_PLAN_PRICING,
        action: { kind: "link", href: "/signup", label: "go", ariaLabel: "go" },
      });
    }
    const html = renderWithIntl("he", createElement(Card));
    assert.doesNotMatch(html, /plan-price-placeholder/);
    assert.match(html, amountRe(DEFAULT_PLAN_PRICING[PUBLIC_PLANS[0].key].ilsMonthly));
  });

  await test("the landing page and HomePage no longer read or pass the grid", () => {
    assert.doesNotMatch(read("app/[locale]/page.tsx"), /getPlanPricingMap|DEFAULT_PLAN_PRICING/);
    assert.doesNotMatch(read("components/marketing/HomePage.tsx"), /PlanPricingMap|pricing=/);
    assert.doesNotMatch(read("components/marketing/Pricing.tsx"), /DEFAULT_PLAN_PRICING/);
  });

  if (failures) {
    console.error(`${failures} PUBLIC-PLAN-PRICING TEST(S) FAILED`);
    process.exit(1);
  }
  console.log("ALL PUBLIC-PLAN-PRICING TESTS PASSED");
}

void main();
