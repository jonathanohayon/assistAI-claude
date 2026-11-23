// Which plan cards the Billing page shows. No list of its own: it applies the
// checkout's rule (canPurchasePlan, lib/plans.ts) to PLANS, in PLANS order.
// That is every public plan plus the customer's current plan, so a legacy
// subscriber still sees their own plan, and no one is offered a switch TO a
// non-public plan.
import { PLANS, canPurchasePlan, type Plan, type PlanKey } from "@/lib/plans";

export function billingPlanCards(currentPlan: PlanKey): Plan[] {
  return PLANS.filter((p) => canPurchasePlan(p.key, currentPlan));
}
