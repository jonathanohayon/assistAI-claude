// The ONE rule for the outbound call centre (campaigns + outbound agents),
// shared by the UI (page, nav tab, config tile) and the API gate
// (lib/campaigns/plan-gate.ts): admins always, otherwise the plan feature.
//
// Its own module, with a TYPE-only import, so client components can use it
// without bundling lib/plan-features.ts (whose admin descriptions name the
// agent's tools: scripts/check-tenant-bundle.mjs).

import type { PlanFeatures } from "@/lib/plan-features";

export function canUseOutboundCampaigns(
  isAdmin: boolean,
  features: Partial<PlanFeatures> | null | undefined,
): boolean {
  return isAdmin || features?.outbound_campaigns === true;
}
