import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { routing, type Locale } from "@/i18n/routing";

// Back-compat redirect /dashboard → /<locale>/dashboard. La dashboard
// complète (layout + tabs + sous-pages) vit désormais sous app/[locale]/
// dashboard. Cet alias préserve les redirects internes :
//  - signOut + redirect("/login") puis user revient
//  - signup → /dashboard (post email-verify)
//  - Twilio provisioning success → /dashboard
//  - middleware /onboarding skip si already provisioned
//
// Locale resolution : cookie NEXT_LOCALE → Accept-Language → defaultLocale.
export default async function LegacyDashboardRedirect(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  let locale: Locale = routing.defaultLocale;
  if (cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)) {
    locale = cookieLocale as Locale;
  } else {
    const accept = (await headers()).get("accept-language") ?? "";
    for (const part of accept.split(",")) {
      const tag = part.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
      if (tag && (routing.locales as readonly string[]).includes(tag)) {
        locale = tag as Locale;
        break;
      }
    }
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
    else if (typeof v === "string") qs.set(k, v);
  }
  const queryString = qs.toString();
  redirect(`/${locale}/dashboard${queryString ? `?${queryString}` : ""}`);
}
