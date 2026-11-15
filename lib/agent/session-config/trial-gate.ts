// The inbound trial gate, MOVED from lib/agent/session-config/inbound.ts so the
// worker's inbound call and the dashboard's agentState share ONE definition of
// "this account's trial refuses calls now". SERVER-ONLY.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { TRIAL_PAUSED_STATUS, isTrialExhausted } from "@/lib/trial";

export interface TrialGateUser {
  id: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  role: string | null;
}

/**
 * null = calls allowed. Otherwise the inbound config is refused (403
 * trial_exhausted): a trialing account past its time or minutes, or a paused
 * one. Admins are exempt. Reads call durations only for a trialing / paused
 * non-admin account, exactly as the inbound handler always did.
 */
export async function inboundTrialRefusal(user: TrialGateUser): Promise<{ trialSecondsUsed: number } | null> {
  if (
    !(user.subscriptionStatus === "trialing" || user.subscriptionStatus === TRIAL_PAUSED_STATUS) ||
    user.role === "admin"
  ) {
    return null;
  }
  const [usage] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${calls.durationSeconds}), 0)::int`,
    })
    .from(calls)
    .where(eq(calls.userId, user.id));
  const trialSecondsUsed = usage?.seconds ?? 0;
  return isTrialExhausted({
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    trialSecondsUsed,
    role: user.role,
  })
    ? { trialSecondsUsed }
    : null;
}
