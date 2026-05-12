import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { routing, type Locale } from "@/i18n/routing";

// Back-compat redirect /signup → /<locale>/signup. La page localisée vit
// désormais sous app/[locale]/signup pour bénéficier du
// NextIntlClientProvider de [locale]/layout.
//
// On choisit la locale par ordre de préférence :
//   1. cookie NEXT_LOCALE (posé par next-intl quand l'user a navigué sur
//      une page localisée)
//   2. Accept-Language header (préférence navigateur, on prend le premier
//      qui matche un locale supporté)
//   3. defaultLocale (fr)
//
// Préserve les query params (?plan=, ?error=, ?billing=) pour que les liens
// du Pricing continuent de fonctionner sans modif.
export default async function LegacySignupRedirect(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;

  // Cookie first.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  let locale: Locale = routing.defaultLocale;
  if (cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)) {
    locale = cookieLocale as Locale;
  } else {
    // Accept-Language fallback. Format : "he-IL,he;q=0.9,fr;q=0.8,en;q=0.7"
    // → on split par virgule puis on extrait le tag avant le `;` et avant le `-`.
    const accept = (await headers()).get("accept-language") ?? "";
    for (const part of accept.split(",")) {
      const tag = part.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
      if (tag && (routing.locales as readonly string[]).includes(tag)) {
        locale = tag as Locale;
        break;
      }
    }
  }

  // Reconstruit la query string telle quelle.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
    else if (typeof v === "string") qs.set(k, v);
  }
  const queryString = qs.toString();
  redirect(`/${locale}/signup${queryString ? `?${queryString}` : ""}`);
}
