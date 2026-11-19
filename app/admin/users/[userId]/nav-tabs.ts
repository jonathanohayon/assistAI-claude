// The admin tenant view's menu entries (pure, unit-tested). Same rule as the
// tenant dashboard (lib/doors-ui.ts): today's order for every door, the home
// tab first and named after the TENANT's door. Rendered by ./_nav.tsx.

import type { DoorTabId } from "@/lib/doors-ui";

export interface AdminTab {
  id: DoorTabId;
  hrefSuffix: string;
  /** Fixed label; the home tab's comes from the tenant's door (Dashboard.<headerKey>). */
  label: string;
}

export const ADMIN_TABS: ReadonlyArray<AdminTab> = [
  { id: "home", hrefSuffix: "", label: "Configuration" },
  { id: "calendar", hrefSuffix: "/calendar", label: "Calendrier" },
  { id: "crm", hrefSuffix: "/contacts", label: "CRM" },
  { id: "calls", hrefSuffix: "/logs", label: "Appels" },
  { id: "billing", hrefSuffix: "/finance", label: "Finance" },
];
