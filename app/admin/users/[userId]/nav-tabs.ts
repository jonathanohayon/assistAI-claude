// The admin tenant view's menu entries (pure, unit-tested), in the TENANT's
// door order, from the same table as the tenant dashboard (lib/doors-ui.ts).
// Rendered by ./_nav.tsx.

import type { Door } from "@/lib/door-values";
import { doorUi, orderBy, type DoorTabId } from "@/lib/doors-ui";

export interface AdminTab {
  id: DoorTabId;
  hrefSuffix: string;
  label: string;
}

export const ADMIN_TABS: ReadonlyArray<AdminTab> = [
  { id: "home", hrefSuffix: "", label: "Configuration" },
  { id: "calendar", hrefSuffix: "/calendar", label: "Calendrier" },
  { id: "crm", hrefSuffix: "/contacts", label: "CRM" },
  { id: "calls", hrefSuffix: "/logs", label: "Appels" },
  { id: "billing", hrefSuffix: "/finance", label: "Finance" },
];

/** Every admin tab (none is gated), in the tenant's door order. */
export function adminTenantTabs(door: Door | null | undefined): AdminTab[] {
  return orderBy(ADMIN_TABS, (tab) => tab.id, doorUi(door).tabOrder);
}
