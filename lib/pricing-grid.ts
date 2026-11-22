// The public pricing section on the product grid (F3a): what each card shows,
// read from the product catalogue (lib/product-catalogue.ts) as served by
// GET /api/public/plan-pricing → `products`. Pure and client-safe: no lib/db,
// no amount of its own. The landing is prerendered, so the catalogue is
// fetched on the client; until it arrives (or if it fails) the cards show a
// placeholder, never a default amount.
//
// One subscription = one BASE product + optional ADD-ONS; minutes are counted
// per product. reception_multi is never an add-on (its add-on prices are null
// by design in the catalogue).
//
// HARD RULE (until P4 / PRODUCT_ORDERS): nothing on this page can buy. Every
// card opens SIGN-UP (free trial) through the product's door.

import type { CatalogueCurrency, ProductCatalogue } from "./product-catalogue";
import type { Currency } from "./landing-currency";
import type { Product } from "./product-values";
import { PUBLIC_PLAN_PRICING_PATH, parsePublicProducts } from "./public-plan-pricing";

export type Billing = "monthly" | "annual";

/** The four cards, in display order. */
export const GRID_PRODUCTS: readonly Product[] = ["reception", "reception_multi", "sales", "connect"] as const;

/** The catalogue's currencies, in the dropdown's order. */
export const GRID_CURRENCIES: readonly CatalogueCurrency[] = ["EUR", "ILS"] as const;

/** Each card's ONLY link: sign-up with the product's door (reception = plain). */
export const GRID_SIGNUP_HREF: Readonly<Record<Product, string>> = {
  reception: "/signup",
  reception_multi: "/signup",
  sales: "/signup?door=sales",
  connect: "/signup?door=connect",
};

/** The landing currency of a locale (lib/landing-currency.ts), mapped onto the
 *  catalogue: ILS stays ILS; USD (English), which the catalogue does not
 *  price, becomes EUR. */
export function catalogueCurrencyOf(c: Currency): CatalogueCurrency {
  return c === "ILS" ? "ILS" : "EUR";
}

export interface GridCard {
  product: Product;
  /** Price as the base, for the period shown. */
  price: number;
  minutes: number;
  overagePerMin: number;
  /** Price when added to another base, for the period shown; null = never an add-on. */
  addon: number | null;
  href: string;
}

/** One card's numbers, straight from the catalogue row. */
export function gridCard(cat: ProductCatalogue, product: Product, currency: CatalogueCurrency, billing: Billing): GridCard {
  const row = cat[product][currency];
  return {
    product,
    price: billing === "annual" ? row.annual : row.monthly,
    minutes: row.minutes,
    overagePerMin: row.overagePerMin,
    addon: billing === "annual" ? row.addonAnnual : row.addonMonthly,
    href: GRID_SIGNUP_HREF[product],
  };
}

/** Number format of the PAGE language (as components/plans/PlanCard.tsx). */
const PAGE_NUMBER_LOCALE: Record<string, string> = { fr: "fr-FR", he: "he-IL", en: "en-US" };

/** A price: whole amounts without decimals, others with two. */
export function formatGridMoney(amount: number, currency: CatalogueCurrency, locale: string): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(PAGE_NUMBER_LOCALE[locale] ?? "fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

/** A per-minute price: always two decimals (0,39 €, 1,50 ₪). */
export function formatGridPerMinute(amount: number, currency: CatalogueCurrency, locale: string): string {
  return new Intl.NumberFormat(PAGE_NUMBER_LOCALE[locale] ?? "fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Client fetch of the catalogue. Null on any failure (network, non-2xx, a
 *  payload the strict parser refuses): the cards keep their placeholder. */
export async function fetchPublicProducts(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ProductCatalogue | null> {
  try {
    const res = await fetchImpl(PUBLIC_PLAN_PRICING_PATH, { signal });
    if (!res.ok) return null;
    return parsePublicProducts(await res.json());
  } catch {
    return null;
  }
}
