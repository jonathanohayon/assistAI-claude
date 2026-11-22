import { redirect } from "next/navigation";

import { dashboardTarget, resolveRequestLocale, type SearchParams } from "@/lib/request-locale";

// Back-compat redirect /dashboard → /<locale>/dashboard. La dashboard
// complète (layout + tabs + sous-pages) vit désormais sous app/[locale]/
// dashboard. Cet alias préserve les redirects internes :
//  - signOut + redirect("/login") puis user revient
//  - signup → /dashboard (post email-verify)
//  - Twilio provisioning success → /dashboard
//  - middleware /onboarding skip si already provisioned
//
// Locale resolution: lib/request-locale.ts (cookie → Accept-Language → default).
// Deeper paths (/dashboard/reception…) go through ./[...rest]/page.tsx.
export default async function LegacyDashboardRedirect(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  redirect(dashboardTarget(await resolveRequestLocale(), [], sp));
}
