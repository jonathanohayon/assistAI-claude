import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { HomePage } from "@/components/marketing/HomePage";
import { buildSalesContent, salesMeta } from "@/lib/marketing/landings/sales";
import { asLandingLocale } from "@/lib/marketing/landings/switches";

// L3: UNLISTED preview of the outbound (sales) landing page. noindex, not in
// any sitemap, linked from nowhere (scripts/tests/landings-unlisted.test.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { ...salesMeta(asLandingLocale(locale)), robots: { index: false, follow: false } };
}

export default async function SalesLanding({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomePage content={buildSalesContent(asLandingLocale(locale))} />;
}
