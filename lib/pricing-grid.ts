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
// card opens SIGN-UP through the product's door.

import type { CatalogueCurrency, ProductCatalogue } from "./product-catalogue";
import type { Currency } from "./landing-currency";
import { entitledProducts } from "./product-entitlement";
import { entryOf, type Product } from "./product-values";
import { TRIAL_PLAN_KEY } from "./plans";
import type { PlanPricingMap } from "./plan-pricing";
import { PUBLIC_PLAN_PRICING_PATH, parsePublicPlanPricing, parsePublicProducts } from "./public-plan-pricing";
import { TRIAL_DURATION_MS, TRIAL_MINUTES_INCLUDED } from "./trial";

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

// The trial the page may promise is TODAY's sign-up trial (lib/trial.ts),
// not the per-product trial of F4: its length and minutes come from there,
// and the products it covers are what a trialing account is entitled to
// (lib/product-entitlement.ts rule 2: reception_multi, i.e. Réception).
// Ventes and Connecter votre agent are not in it: their cards say so and
// their CTA is a neutral "create my account" (still sign-up).
export const SIGNUP_TRIAL = {
  days: Math.round(TRIAL_DURATION_MS / 86_400_000),
  minutes: TRIAL_MINUTES_INCLUDED,
} as const;

const SIGNUP_TRIAL_ENTRIES = entitledProducts({
  subscriptionPlan: TRIAL_PLAN_KEY,
  subscriptionStatus: "trialing",
  products: null,
}).entries;

/** Whether today's sign-up trial covers this product's dashboard entry. */
export function inSignupTrial(p: Product): boolean {
  return SIGNUP_TRIAL_ENTRIES.includes(entryOf(p));
}

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

// ── Which section the page shows ──────────────────────────────────────────
// The route says whether new orders are sold (server-side PRODUCT_ORDERS):
// "products" shows the product grid; anything else, a missing field, a
// failed fetch, or the time before the answer arrives, shows TODAY's plan
// cards ("legacy"), so production never flashes the new grid.
// Ventes / Connecter availability rides along; missing = not available.

export type PricingMode = "legacy" | "products";
export type ProductAvailability = { sales: boolean; connect: boolean };
export const NOT_AVAILABLE: ProductAvailability = { sales: false, connect: false };

export interface PublicPricing {
  mode: PricingMode;
  /** The old plan grid (legacy cards); null if absent or invalid. */
  plans: PlanPricingMap | null;
  /** The product catalogue (product cards); null if absent or invalid. */
  products: ProductCatalogue | null;
  available: ProductAvailability;
}

/** The route's mode field: only the exact string "products" opens the grid. */
export function parsePricingMode(raw: unknown): PricingMode {
  return raw && typeof raw === "object" && (raw as Record<string, unknown>).grid === "products" ? "products" : "legacy";
}

/** Per-product availability: true only where the route says exactly true. */
export function parseAvailability(raw: unknown): ProductAvailability {
  const a = raw && typeof raw === "object" ? (raw as Record<string, unknown>).available : null;
  if (!a || typeof a !== "object" || Array.isArray(a)) return { ...NOT_AVAILABLE };
  const o = a as Record<string, unknown>;
  return { sales: o.sales === true, connect: o.connect === true };
}

/** The whole public payload, each part parsed strictly on its own. */
export function parsePublicPricing(raw: unknown): PublicPricing {
  return {
    mode: parsePricingMode(raw),
    plans: parsePublicPlanPricing(raw),
    products: parsePublicProducts(raw),
    available: parseAvailability(raw),
  };
}

/** The section to render for what has been fetched (null = not yet, or failed). */
export function pricingView(p: PublicPricing | null): PricingMode {
  return p?.mode === "products" ? "products" : "legacy";
}

/** Whether a product's card can be signed up for now (Réception always). */
export function isAvailable(product: Product, available: ProductAvailability): boolean {
  return product === "sales" ? available.sales : product === "connect" ? available.connect : true;
}

/** ONE client fetch of the route. Null on any failure (network, non-2xx,
 *  not JSON): the page then keeps today's cards and their placeholders. */
export async function fetchPublicPricing(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PublicPricing | null> {
  try {
    const res = await fetchImpl(PUBLIC_PLAN_PRICING_PATH, { signal });
    if (!res.ok) return null;
    return parsePublicPricing(await res.json());
  } catch {
    return null;
  }
}
