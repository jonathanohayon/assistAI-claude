import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { HomePage } from "@/components/marketing/HomePage";
import { buildSalesContent, salesMeta } from "@/lib/marketing/landings/sales";
import { asLandingLocale } from "@/lib/marketing/landings/switches";
import { DEFAULT_PLAN_PRICING } from "@/lib/plan-pricing";

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
  // No pricing slot on this page: the default map only satisfies the prop.
  return <HomePage content={buildSalesContent(asLandingLocale(locale))} pricing={DEFAULT_PLAN_PRICING} />;
}
