// The ONE plan the outbound call centre is sold with: the upsell modal, the
// locked campaigns tile and the "import contacts" step all name it from here
// (they used to say "Pro" in two places and the plan's real name in a third).
// Client-safe: lib/plans.ts only.

import { planByKey, type PlanKey } from "@/lib/plans";

export const OUTBOUND_UPSELL_PLAN_KEY: PlanKey = "premium";

/**
 * The plan's name in the reader's language: the Plans.<key>.name message when
 * the locale has one, else the plan data's name.
 */
export function outboundPlanName(localized: (key: string) => string | null): string {
  return localized(`${OUTBOUND_UPSELL_PLAN_KEY}.name`) ?? planByKey(OUTBOUND_UPSELL_PLAN_KEY).name;
}
