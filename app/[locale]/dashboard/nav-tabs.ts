// The dashboard menu entries (pure, client-safe, unit-tested): what each tab
// is, its gate, and the visible list in the account's door order.
// Rendered by ./_nav.tsx.

import type { Door } from "@/lib/door-values";
import { doorUi, orderBy, type DoorTabId } from "@/lib/doors-ui";
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
 * The tabs this account sees, in its door's order. The door only ORDERS:
 * the gate (plan features, admin bypass) is applied after, the same for
 * every door.
 */
export function visibleTabs(
  features: PlanFeatures,
  isAdmin: boolean,
  door: Door | null | undefined,
): Tab[] {
  return orderBy(TABS, (tab) => tab.id, doorUi(door).tabOrder).filter(
    (tab) =>
      isAdmin ||
      (!tab.feature && !tab.featureAny) ||
      (tab.feature && features[tab.feature]) ||
      (tab.featureAny && tab.featureAny.some((f) => features[f])),
  );
}
