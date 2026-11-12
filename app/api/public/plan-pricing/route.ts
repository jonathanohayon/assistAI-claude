import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { publicPlanPricingResponse } from "@/lib/public-plan-pricing";

// GET /api/public/plan-pricing — PUBLIC, no auth. The plan grid shown on the
// landing (the same map /admin edits). Read per request and cached by the CDN
// through Cache-Control (see lib/public-plan-pricing.ts), so the prerendered
// landing never has to embed a price.
export const dynamic = "force-dynamic";

export function GET() {
  return publicPlanPricingResponse(getPlanPricingMap);
}
