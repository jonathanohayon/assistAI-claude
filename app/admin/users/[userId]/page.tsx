import type { SearchParams } from "@/lib/dashboard-nav";
import { redirectAdminLegacy } from "@/lib/dashboard-redirect";

// Old URL /admin/users/<id>: redirected to the TENANT's own product (its
// door), or to the page holding ?tile= (lib/dashboard-nav.ts). The query string is kept; the admin gate runs first.
export default async function LegacyAdminPage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { userId } = await props.params;
  return redirectAdminLegacy(userId, "", await props.searchParams);
}
