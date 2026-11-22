import type { SearchParams } from "@/lib/dashboard-nav";
import { redirectTenantLegacy } from "@/lib/dashboard-redirect";

// Old URL /dashboard/calendar: redirected to its new home in the left menu
// (lib/dashboard-nav.ts, LEGACY_TENANT_PATHS). The query string is kept.
export default async function LegacyPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await props.params;
  return redirectTenantLegacy(locale, "/calendar", await props.searchParams);
}
