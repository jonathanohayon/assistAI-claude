import type { SearchParams } from "@/lib/dashboard-nav";
import { redirectAdminLegacy } from "@/lib/dashboard-redirect";

// Old URL /admin/users/<id>/contacts: redirected to its new home in the menu
// (lib/dashboard-nav.ts, LEGACY_ADMIN_PATHS). The query string is kept; the admin gate runs first.
export default async function LegacyAdminPage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { userId } = await props.params;
  return redirectAdminLegacy(userId, "/contacts", await props.searchParams);
}
