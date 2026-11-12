import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { HomePage } from "@/components/marketing/HomePage";
import { buildConnectContent, connectMeta } from "@/lib/marketing/landings/connect";
import { asLandingLocale } from "@/lib/marketing/landings/switches";

// L4: UNLISTED preview of "give your AI agent a voice and a number". The
// capability is not live on calls yet; the page says so. noindex, not in any
// sitemap, linked from nowhere (scripts/tests/landings-unlisted.test.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { ...connectMeta(asLandingLocale(locale)), robots: { index: false, follow: false } };
}

export default async function ConnectLanding({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomePage content={buildConnectContent(asLandingLocale(locale))} />;
}
