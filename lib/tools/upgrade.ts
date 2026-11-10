// "Available with the … plan": for each capability the plan doesn't include,
// the cheapest PUBLIC plan whose matrix row includes it. Pure.
import type { PlanFeatureMatrix } from "@/lib/plan-features";
import type { Plan, PlanKey } from "@/lib/plans";
import type { CapabilityKey, EffectiveCapabilities } from "@/lib/tools/contract";

const FEATURE: Partial<Record<CapabilityKey, "calendar" | "crm">> = { booking: "calendar", contacts: "crm", orders: "crm" };

export function upgradePlans(
  caps: EffectiveCapabilities,
  matrix: PlanFeatureMatrix,
  plans: readonly Plan[],
): Partial<Record<CapabilityKey, PlanKey>> {
  const byPrice = plans.filter((p) => p.public).slice().sort((a, b) => a.monthly - b.monthly);
  const out: Partial<Record<CapabilityKey, PlanKey>> = {};
  for (const [key, state] of Object.entries(caps) as [CapabilityKey, EffectiveCapabilities[CapabilityKey]][]) {
    const f = FEATURE[key];
    if (state.planIncluded || !f) continue;
    const p = byPrice.find((pl) => matrix[pl.key]?.[f]);
    if (p) out[key] = p.key;
  }
  return out;
}
