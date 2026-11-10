// Server-side inputs of effectiveCapabilities for an account (T1).
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featuresForPlan, type PlanFeatures } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import type { CapabilityAccount } from "@/lib/tools/contract";

/** The account's plan features and capability prerequisites. */
export async function capabilityInputsFor(
  userId: string,
): Promise<{ plan: PlanFeatures; account: Omit<CapabilityAccount, "transferNumber"> }> {
  const [[user], matrix] = await Promise.all([
    db
      .select({ plan: users.subscriptionPlan, google: users.googleRefreshToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    getPlanFeatureMatrix(),
  ]);
  return {
    plan: featuresForPlan(matrix, user?.plan ?? null),
    account: { googleConnected: Boolean(user?.google) },
  };
}
