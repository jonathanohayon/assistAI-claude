import { setRequestLocale } from "next-intl/server";

import { DEFAULT_PLAN_PRICING, type PlanPricingMap } from "@/lib/plan-pricing";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { HomePage } from "@/components/marketing/HomePage";
import { RECEPTIONIST_HOME } from "@/lib/marketing/home-content";

// ISR : la landing reste cachée/statique mais se régénère toutes les 10 min
// pour refléter les tarifs édités dans /admin sans redéploiement.
export const revalidate = 600;

// Redesign 2026-06 : 16 → 12 sections. Les fusions (Journey = TwoMinutesToLive
// +HowItWorks, FeatureBento = Features+VoiceConfigShowcase, Proof =
// PerformanceShowcase+SocialProof, TrustStrip = Security compressée) suppriment
// les répétitions, pas les arguments. 2026-11-05: OutboundCalling removed
// from the public page (salons and clinics only; outbound stays in the app).
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Build-safe : si la DB n'est pas joignable au build, on retombe sur les
  // tarifs par défaut (la régénération ISR lira les vrais ensuite).
  let pricing: PlanPricingMap;
  try {
    pricing = await getPlanPricingMap();
  } catch {
    pricing = DEFAULT_PLAN_PRICING;
  }
  // The sections, their order and their content come from the content
  // object (lib/marketing/home-content.ts).
  return <HomePage content={RECEPTIONIST_HOME} pricing={pricing} />;
}
