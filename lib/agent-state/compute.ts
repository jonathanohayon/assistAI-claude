// agentState for one account (dashboard hero + admin tenant view). SERVER-ONLY.
// Never part of a worker-facing payload (pinned in
// scripts/tests/worker-runtime-config.test.ts).

import { eq } from "drizzle-orm";

import { buildInboundConfig, DRY_INBOUND_EFFECTS } from "@/lib/agent/session-config/inbound";
import { inboundTrialRefusal } from "@/lib/agent/session-config/trial-gate";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { readHeartbeat } from "@/lib/monitoring";

import { decideAgentState, engineReachable, trialReason } from "./decide";
import type { AgentState } from "./types";

/**
 * Check 3: run the worker's inbound resolver for this number exactly as a
 * phone call would (`?phone=`), with the dry-run effects: no event, alert,
 * forwarding mark, caller profile or DNS (lib/agent/session-config/inbound.ts
 * DRY_INBOUND_EFFECTS). Built = 200; any refusal (404 unknown number / no
 * tenant, 403) or a throw = unavailable. The body is never served.
 */
export async function inboundConfigBuilds(phoneNumber: string): Promise<boolean> {
  // WhatsApp rows are stored "whatsapp:+…"; the worker sends the bare number.
  const phone = phoneNumber.replace(/^whatsapp:/, "");
  try {
    const res = await buildInboundConfig(new URLSearchParams({ phone }), DRY_INBOUND_EFFECTS);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function computeAgentState(userId: string): Promise<AgentState> {
  // One settings read (worker_heartbeat) per call, in parallel with the
  // account queries.
  const [[user], [number], heartbeat] = await Promise.all([
    db
      .select({
        id: users.id,
        subscriptionStatus: users.subscriptionStatus,
        trialEndsAt: users.trialEndsAt,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    // The number the hero shows (same query as the dashboard page).
    db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, userId))
      .limit(1),
    readHeartbeat(),
  ]);
  const now = Date.now();
  return decideAgentState({
    hasNumber: () => Boolean(user && number),
    trialRefusal: async () => trialReason((await inboundTrialRefusal(user!))?.cause),
    configAvailable: () => inboundConfigBuilds(number!.phoneNumber),
    engineReachable: () => engineReachable(heartbeat, now),
  });
}
