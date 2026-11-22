import type { SearchParams } from "@/lib/dashboard-nav";
import { redirectTenantLegacy } from "@/lib/dashboard-redirect";

// Old URL /dashboard: redirected to the account's own product (its door),
// or to the page holding ?tile=, in the left menu (lib/dashboard-nav.ts). The query string is kept.
export default async function LegacyPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await props.params;
  return redirectTenantLegacy(locale, "", await props.searchParams);
}
