// Public plan pricing for the landing, served by GET /api/public/plan-pricing
// and fetched on the client by the pricing section. The landing HTML is
// prerendered, so it must never carry a price: an edit in /admin would only
// show up after a rebuild or a revalidation, and a build without DB access
// would bake in the defaults. Client-safe: no lib/db import here (the route
// passes the loader in).

import { PLANS } from "@/lib/plans";
import { PRICE_FIELDS, type PlanPricingMap } from "@/lib/plan-pricing";
import { parseProductCatalogue, type ProductCatalogue } from "@/lib/product-catalogue";

export const PUBLIC_PLAN_PRICING_PATH = "/api/public/plan-pricing";

// Short CDN cache: an admin price edit is visible within about a minute, and a
// burst of landing visits costs one DB read per minute at most.
export const PUBLIC_PLAN_PRICING_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

/** Builds the API response: the plan map exactly as before, plus (when
 *  `loadProducts` is given) the product catalogue under a trailing `products`
 *  key, an ADDITIVE field: the plan keys keep their bytes. A failed load is a
 *  503 that is never cached and carries no price, so the client shows its
 *  placeholder instead. */
export async function publicPlanPricingResponse(
  load: () => Promise<PlanPricingMap>,
  loadProducts?: () => Promise<ProductCatalogue>,
): Promise<Response> {
  try {
    const pricing = await load();
    const body = loadProducts ? { ...pricing, products: await loadProducts() } : pricing;
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
