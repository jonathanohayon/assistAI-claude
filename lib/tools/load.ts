// Server-side inputs of effectiveCapabilities for an account (T1).
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { featuresForPlan, type PlanFeatures } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import type { CapabilityAccount } from "@/lib/tools/contract";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";
import { outboundToolsEnabled, outboundToolsMode } from "@/lib/tools/outbound-switch";
import { accountTransferNumber } from "@/lib/tools/store";

/**
 * The account's plan features and capability prerequisites — for its
 * OUTBOUND agents: Google, the account's transfer number (the receptionist
 * row's, parked included) and the OUTBOUND_TOOLS switch for this account.
 */
export async function capabilityInputsFor(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ plan: PlanFeatures; account: Required<CapabilityAccount> }> {
  const [[user], [cfg], matrix] = await Promise.all([
    db
      .select({ plan: users.subscriptionPlan, google: users.googleRefreshToken, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ transferNumber: agentConfigs.transferNumber, transferNumberParked: agentConfigs.transferNumberParked })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .limit(1),
    getPlanFeatureMatrix(),
  ]);
  return {
    plan: featuresForPlan(matrix, user?.plan ?? null),
    account: {
      googleConnected: Boolean(user?.google),
      transferNumber: cfg ? accountTransferNumber(cfg) : "",
      outboundToolsEnabled: outboundToolsEnabled(outboundToolsMode(env), user?.role === "admin"),
      clientAgentEnabled: clientAgentEnabled(clientAgentMode(env), user?.role === "admin"),
    },
  };
}
