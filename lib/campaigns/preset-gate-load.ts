// Server side of the M2d preset gate: is booking EFFECTIVE for this agent?
// The SAME computation as the outbound call's session config
// (lib/agent/session-config/campaign.ts): the account's capability inputs
// (OUTBOUND_TOOLS switch, plan, Google) + the agent's tools config.
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import { capabilityInputsFor } from "@/lib/tools/load";
import { outboundCapabilities } from "@/lib/tools/store";

/** No agent (or one of another account) → the default outbound tools → booking off. */
export async function outboundBookingActive(userId: string, agentId: string | null): Promise<boolean> {
  const agent = agentId
    ? ((
        await db
          .select({ toolsConfig: outboundAgents.toolsConfig })
          .from(outboundAgents)
          .where(and(eq(outboundAgents.id, agentId), eq(outboundAgents.userId, userId)))
          .limit(1)
      )[0] ?? null)
    : null;
  const inputs = await capabilityInputsFor(userId);
  return outboundCapabilities(agent?.toolsConfig ?? null, inputs.account, inputs.plan).capabilities.booking.active;
}
