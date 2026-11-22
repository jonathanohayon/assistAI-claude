// Public plan pricing for the landing, served by GET /api/public/plan-pricing
// and fetched on the client by the pricing section. The landing HTML is
// prerendered, so it must never carry a price: an edit in /admin would only
// show up after a rebuild or a revalidation, and a build without DB access
// would bake in the defaults. Client-safe: no lib/db import here (the route
// passes the loader in).

import { PLANS } from "@/lib/plans";
import { PRICE_FIELDS, type PlanPricingMap } from "@/lib/plan-pricing";
import { parseProductCatalogue, type ProductCatalogue } from "@/lib/product-catalogue";

/** Which pricing grid the landing shows: the legacy plan cards, or the
 *  product grid. */
export type PublicGrid = "legacy" | "products";
export const PUBLIC_GRIDS: readonly PublicGrid[] = ["legacy", "products"];

/** Whether a NEW account could buy and use each optional product today. */
export type PublicAvailability = { sales: boolean; connect: boolean };

/** The two offer fields of the response (computed server-side). */
export type PublicOfferFields = { grid: PublicGrid; available: PublicAvailability };

export const PUBLIC_PLAN_PRICING_PATH = "/api/public/plan-pricing";

// Short CDN cache: an admin price edit is visible within about a minute, and a
// burst of landing visits costs one DB read per minute at most.
export const PUBLIC_PLAN_PRICING_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

/** Builds the API response: the plan map exactly as before, plus (when
 *  `loadProducts` is given) the product catalogue under a trailing `products`
 *  key, plus (when `offer` is given) the trailing `grid` and `available`
 *  keys. Every one is an ADDITIVE field: the earlier keys keep their bytes.
 *  A failed load is a 503 that is never cached and carries no price, so the
 *  client shows its placeholder instead. The offer rides the same CDN cache
 *  as the prices. */
export async function publicPlanPricingResponse(
  load: () => Promise<PlanPricingMap>,
  loadProducts?: () => Promise<ProductCatalogue>,
  offer?: () => PublicOfferFields,
): Promise<Response> {
  try {
    const pricing = await load();
    const withProducts = loadProducts ? { ...pricing, products: await loadProducts() } : pricing;
    const body = offer ? { ...withProducts, ...pickOffer(offer()) } : withProducts;
    return Response.json(body, {
      headers: { "Cache-Control": PUBLIC_PLAN_PRICING_CACHE_CONTROL },
    });
  } catch {
    return Response.json(
      { error: "pricing_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Strict parse: every plan and every amount must be present and valid,
 *  otherwise null. No filling from the defaults, on purpose. */
export function parsePublicPlanPricing(raw: unknown): PlanPricingMap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = {} as PlanPricingMap;
  for (const p of PLANS) {
    const row = r[p.key];
    if (!row || typeof row !== "object") return null;
    const v = row as Record<string, unknown>;
    const price = {} as PlanPricingMap[typeof p.key];
    for (const f of PRICE_FIELDS) {
      const n = v[f];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
      price[f] = n;
    }
    out[p.key] = price;
  }
  return out;
}

/** Strict parse of the response's `products` field (the product catalogue),
 *  else null. Independent of the plan keys. */
export function parsePublicProducts(raw: unknown): ProductCatalogue | null {
  if (!raw || typeof raw !== "object") return null;
  return parseProductCatalogue((raw as Record<string, unknown>).products);
}

// Only the two keys, in this order, whatever the producer returns.
const pickOffer = (o: PublicOfferFields): PublicOfferFields => ({
  grid: o.grid,
  available: { sales: o.available.sales, connect: o.available.connect },
});

/** Strict parse of the response's `grid` field, else null (an older server
 *  without it: the caller keeps the legacy grid). */
export function parsePublicGrid(raw: unknown): PublicGrid | null {
  if (!raw || typeof raw !== "object") return null;
  const g = (raw as Record<string, unknown>).grid;
  return typeof g === "string" && (PUBLIC_GRIDS as readonly string[]).includes(g) ? (g as PublicGrid) : null;
}

/** Strict parse of the response's `available` field, else null (an older
 *  server without it: the caller treats both products as unavailable). */
export function parsePublicAvailability(raw: unknown): PublicAvailability | null {
  if (!raw || typeof raw !== "object") return null;
  const a = (raw as Record<string, unknown>).available;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const { sales, connect } = a as Record<string, unknown>;
  if (typeof sales !== "boolean" || typeof connect !== "boolean") return null;
  return { sales, connect };
}

/** Both offer fields, or null when either is missing or invalid. */
export function parsePublicOffer(raw: unknown): PublicOfferFields | null {
  const grid = parsePublicGrid(raw);
  const available = parsePublicAvailability(raw);
  return grid && available ? { grid, available } : null;
}

/** Client fetch. Resolves to null on any failure (network, non-2xx, bad
 *  payload): the caller then keeps showing no price. */
export async function fetchPublicPlanPricing(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PlanPricingMap | null> {
  try {
    const res = await fetchImpl(PUBLIC_PLAN_PRICING_PATH, { signal });
    if (!res.ok) return null;
    return parsePublicPlanPricing(await res.json());
  } catch {
    return null;
  }
}
