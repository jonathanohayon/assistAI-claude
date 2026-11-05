// Call-forwarding setup check — SERVER-ONLY DB side.

import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { FORWARDING_TEST_WINDOW_MS, verificationMethod } from "@/lib/forwarding-test";

/**
 * Called for every inbound PHONE call to a tenant's number (call start via
 * /api/agent/config, call end as a fallback). One conditional UPDATE that
 * only matches while a test window is open and not yet detected — so the
 * first call in the window wins. Never throws: must not affect a call.
 */
export async function markForwardingTestCall(
  userId: string,
  opts: { forwardedFrom?: string | null; via: "call_start" | "call_end" },
): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - FORWARDING_TEST_WINDOW_MS);
    const [open] = await db
      .select({ businessPhone: agentConfigs.forwardingBusinessPhone })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.userId, userId), gte(agentConfigs.forwardingTestStartedAt, windowStart)))
      .limit(1);
    if (!open) return false; // no test running: the common case, one indexed read
    const method = verificationMethod(opts.forwardedFrom, open.businessPhone);
    const hit = await db
      .update(agentConfigs)
      .set({
        forwardingDetectedAt: sql`now()`,
        forwardingVerifiedAt: sql`now()`,
        forwardingVerifiedMethod: method,
      })
      .where(
        and(
          eq(agentConfigs.userId, userId),
          gte(agentConfigs.forwardingTestStartedAt, windowStart),
          or(
            isNull(agentConfigs.forwardingDetectedAt),
            sql`${agentConfigs.forwardingDetectedAt} < ${agentConfigs.forwardingTestStartedAt}`,
          ),
        ),
      )
      .returning({ id: agentConfigs.id });
    if (hit.length === 0) return false;
    await logEvent({
      source: "tenant",
      event: "forwarding_verified",
      message: `Call forwarding verified (${method}): a call reached the agent during the test window`,
      userId,
      metadata: { via: opts.via, method },
    });
    return true;
  } catch (e) {
    console.error("[forwarding-test] mark failed", e);
    return false;
  }
}
