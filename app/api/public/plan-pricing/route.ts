import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { getProductCatalogue } from "@/lib/products";
import { publicOffer } from "@/lib/public-offer";
import { publicPlanPricingResponse } from "@/lib/public-plan-pricing";

// GET /api/public/plan-pricing — PUBLIC, no auth. The plan grid shown on the
// landing (the same map /admin edits). Read per request and cached by the CDN
// through Cache-Control (see lib/public-plan-pricing.ts), so the prerendered
// landing never has to embed a price. The product catalogue's public numbers
// ride along under `products`, then the offer under `grid` and `available`
// (lib/public-offer.ts: values only, computed from this deployment's switches;
// a switch change reaches visitors after the CDN cache TTL). All additive: the
// plan keys are unchanged.
export const dynamic = "force-dynamic";

export function GET() {
  return publicPlanPricingResponse(getPlanPricingMap, () => getProductCatalogue(), () => publicOffer());
}
