// Locale + target resolution for the un-prefixed /dashboard aliases
// (app/dashboard/page.tsx and app/dashboard/[...rest]/page.tsx).
// Order: NEXT_LOCALE cookie, then Accept-Language (first supported tag, in
// header order), then routing.defaultLocale.
import { cookies, headers } from "next/headers";

import { routing, type Locale } from "@/i18n/routing";

export type SearchParams = Record<string, string | string[] | undefined>;

function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (routing.locales as readonly string[]).includes(v);
}

/** Pure: cookie value wins, then the first supported Accept-Language tag, then the default. */
export function pickLocale(cookieLocale: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return routing.defaultLocale;
}

/** Reads the request's NEXT_LOCALE cookie and Accept-Language header. */
export async function resolveRequestLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const accept = (await headers()).get("accept-language");
  return pickLocale(cookieLocale, accept);
}

/** "?a=1&a=2" (repeated keys kept), or "" when there is no query. */
export function buildQueryString(sp: SearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
    else if (typeof v === "string") qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// A dashboard path segment is a plain slug or id. Anything else (".", "..",
// empty, a decoded "/" or "\", "%", spaces, control chars) is not a page we
// have, so the whole tail is dropped and the user lands on the dashboard home.
const SAFE_SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

/** Pure: the redirect target, always /<locale>/dashboard[/<safe segments>][?query]. */
export function dashboardTarget(locale: Locale, rest: readonly string[] | undefined, sp: SearchParams): string {
  const segments = rest ?? [];
  const safe = segments.length > 0 && segments.every((s) => SAFE_SEGMENT.test(s));
  const tail = safe ? `/${segments.map(encodeURIComponent).join("/")}` : "";
  return `/${locale}/dashboard${tail}${buildQueryString(sp)}`;
}
