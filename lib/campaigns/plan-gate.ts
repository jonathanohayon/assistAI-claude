// Server-side gate for the outbound call centre (campaigns + outbound agents).
// SERVER-ONLY. The SAME rule as the UI (the /dashboard/campaigns page, the
// nav tab and the config tile): an admin always; otherwise the session
// user's plan must have `outbound_campaigns` (lib/plan-features.ts, which
// forces it off for every plan since the 2026-11 grid). The page and the API
// both call loadOutboundCampaignsAccess, so they cannot disagree.
//
// Whose plan: the SESSION user's. A non-admin can only act on their own
// account (?asUserId is refused for them by resolveTargetUserId), and an
// admin bypasses, including when acting for a tenant via ?asUserId.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { canUseOutboundCampaigns, featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";

export const OUTBOUND_FEATURE = "outbound_campaigns" as const;

/** Access to the outbound call centre for a signed-in user id. */
export async function loadOutboundCampaignsAccess(
  userId: string,
): Promise<{ isAdmin: boolean; enabled: boolean }> {
  const [me] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const isAdmin = me?.role === "admin";
  if (isAdmin) return { isAdmin, enabled: true };
  const features = featuresForPlan(await getPlanFeatureMatrix(), me?.subscriptionPlan);
  return { isAdmin, enabled: canUseOutboundCampaigns(isAdmin, features) };
}

/** The 403 body a tenant without the feature gets. */
export function planFeatureRequired(): NextResponse {
  return NextResponse.json(
    { error: "plan_feature_required", feature: OUTBOUND_FEATURE },
    { status: 403 },
  );
}

/**
 * Call AFTER the route's own 401/403 scope checks. Returns the 403 response
 * to send, or null when the session user may use the call centre.
 * Fails closed: no session → 401 (routes answer that themselves first).
 */
export async function outboundCampaignsGate(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { enabled } = await loadOutboundCampaignsAccess(session.user.id);
  return enabled ? null : planFeatureRequired();
}
