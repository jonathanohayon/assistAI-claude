// The ONE rule for the outbound call centre (campaigns + outbound agents),
// shared by the UI (page, nav tab, config tile) and the API gate
// (lib/campaigns/plan-gate.ts): admins always, otherwise the plan feature.
//
// Its own module, with a type-only import, so a client component can use it
// without pulling lib/plan-features' FEATURE_DEFS (which name the agent's
// tools) into a tenant's bundle (scripts/check-tenant-bundle.mjs).
// lib/plan-features.ts re-exports it for server callers.

import type { PlanFeatures } from "@/lib/plan-features";

export function canUseOutboundCampaigns(
  isAdmin: boolean,
  features: Partial<PlanFeatures> | null | undefined,
): boolean {
  return isAdmin || features?.outbound_campaigns === true;
}
