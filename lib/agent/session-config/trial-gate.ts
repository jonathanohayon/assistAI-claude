// The inbound trial gate, MOVED from lib/agent/session-config/inbound.ts so the
// worker's inbound call and the dashboard's agentState share ONE definition of
// "this account's trial refuses calls now". SERVER-ONLY.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { signupTrialGateApplies, trialExhaustionCause, type TrialExhaustionCause } from "@/lib/trial";

export { signupTrialGateApplies };

export interface TrialGateUser {
  id: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  role: string | null;
}

/**
 * The seconds the sign-up trial gate counts: every calls row of the account,
 * all time (no billing period). The ONE count, shared by the gate and the
 * billing display, so they can never disagree.
 */
export async function signupTrialSecondsUsed(userId: string): Promise<number> {
  const [usage] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${calls.durationSeconds}), 0)::int`,
    })
    .from(calls)
    .where(eq(calls.userId, userId));
  return usage?.seconds ?? 0;
}

/**
 * null = calls allowed. Otherwise the inbound config is refused (403
 * trial_exhausted): a trialing account past its time or minutes, or a paused
 * one. Admins are exempt. Reads call durations only for a trialing / paused
 * non-admin account, exactly as the inbound handler always did.
 * `cause` names the condition that refused (lib/trial.ts
 * trialExhaustionCause); the inbound handler ignores it (its 403 and event
 * are unchanged), agentState maps it to its reason.
 */
export async function inboundTrialRefusal(
  user: TrialGateUser,
): Promise<{ trialSecondsUsed: number; cause: TrialExhaustionCause } | null> {
  if (!signupTrialGateApplies(user)) return null;
  const trialSecondsUsed = await signupTrialSecondsUsed(user.id);
  const cause = trialExhaustionCause({
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    trialSecondsUsed,
    role: user.role,
  });
  return cause ? { trialSecondsUsed, cause } : null;
}
