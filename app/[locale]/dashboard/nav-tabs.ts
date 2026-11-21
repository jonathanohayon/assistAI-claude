// The dashboard menu entries (pure, client-safe, unit-tested): what each tab
// is, its gate, and the visible list (today's order for every door).
// Rendered by ./_nav.tsx.

import type { DoorTabId } from "@/lib/doors-ui";
import type { FeatureKey, PlanFeatures } from "@/lib/plan-features";

export interface Tab {
  id: DoorTabId;
  href: string;
  labelKey: string;
  // Si défini, l'onglet n'apparaît que si la feature est activée pour le
  // plan du tenant (matrice admin éditable). Sans gate = toujours visible.
  feature?: FeatureKey;
  // Comme `feature`, mais visible si AU MOINS UNE des features est activée.
  featureAny?: FeatureKey[];
}

export const TABS: ReadonlyArray<Tab> = [
  // The home tab's label is the door's title (doorUi(door).headerKey).
  { id: "home", href: "/dashboard", labelKey: "tabConfiguration" },
  {
    id: "campaigns",
    href: "/dashboard/campaigns",
    labelKey: "tabOutbound",
    feature: "outbound_campaigns",
  },
  {
    id: "crm",
    href: "/dashboard/crm",
    labelKey: "tabCalendarCrm",
    featureAny: ["calendar", "crm"],
  },
  { id: "billing", href: "/dashboard/billing", labelKey: "tabBilling" },
  { id: "calls", href: "/dashboard/logs", labelKey: "tabLogs" },
];

/**
 * The tabs this account sees, in today's order (home first) for every door:
 * the door only names the home tab (doorUi(door).headerKey). The gate (plan
 * features, admin bypass) is unchanged.
 */
export function visibleTabs(features: PlanFeatures, isAdmin: boolean): Tab[] {
  return TABS.filter(
    (tab) =>
      isAdmin ||
      (!tab.feature && !tab.featureAny) ||
      (tab.feature && features[tab.feature]) ||
      (tab.featureAny && tab.featureAny.some((f) => features[f])),
  );
}
