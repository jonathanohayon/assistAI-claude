import { setRequestLocale } from "next-intl/server";

import { HomePage } from "@/components/marketing/HomePage";
import { RECEPTIONIST_HOME } from "@/lib/marketing/home-content";

// Fully static per locale (prerendered at build, see [locale]/layout.tsx).
// No data is read here: the plan prices are fetched on the client from
// GET /api/public/plan-pricing, so an admin price edit needs no rebuild and
// the HTML never carries a price.
//
// Redesign 2026-06: 16 → 12 sections. The merges (Journey = TwoMinutesToLive
// + HowItWorks, FeatureBento = Features + VoiceConfigShowcase, Proof =
// PerformanceShowcase + SocialProof, TrustStrip = compressed Security) remove
// repetition, not arguments. 2026-11-05: OutboundCalling removed from the
// public page (salons and clinics only; outbound stays in the app).
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The sections, their order and their content come from the content
  // object (lib/marketing/home-content.ts).
  return <HomePage content={RECEPTIONIST_HOME} />;
}
