// Test double for @/lib/plan-features: everything is the real module, except
// that featuresForPlan honours the STORED matrix for outbound_campaigns while
// globalThis.__campgateLiftForceOff is true — the only way to have a plan that
// HAS the feature, since the real one forces it off for every plan.
export * from "../../../../lib/plan-features";
import { featuresForPlan as realFeaturesForPlan, type PlanFeatureMatrix, type PlanFeatures, type PlanKey } from "../../../../lib/plan-features";

const g = globalThis as { __campgateLiftForceOff?: boolean };
export function featuresForPlan(matrix: PlanFeatureMatrix, plan: string | null | undefined): PlanFeatures {
  const f = realFeaturesForPlan(matrix, plan);
  if (!g.__campgateLiftForceOff) return f;
  const stored = plan && plan in matrix ? matrix[plan as PlanKey] : matrix.premium;
  return { ...f, outbound_campaigns: stored.outbound_campaigns === true };
}
