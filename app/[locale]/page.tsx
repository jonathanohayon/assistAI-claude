import { setRequestLocale } from "next-intl/server";

import { DEFAULT_PLAN_PRICING, type PlanPricingMap } from "@/lib/plan-pricing";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { CTA } from "@/components/marketing/CTA";
import { FAQ } from "@/components/marketing/FAQ";
import { FeatureBento } from "@/components/marketing/FeatureBento";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { Industries } from "@/components/marketing/Industries";
import { IntegrationsStrip } from "@/components/marketing/IntegrationsStrip";
import { Journey } from "@/components/marketing/Journey";
import { Nav } from "@/components/marketing/Nav";
import { OutboundCalling } from "@/components/marketing/OutboundCalling";
import { Pricing } from "@/components/marketing/Pricing";
import { Proof } from "@/components/marketing/Proof";
import { SupportFab } from "@/components/marketing/SupportFab";
import { TrustStrip } from "@/components/marketing/TrustStrip";
import { TryDemo } from "@/components/marketing/TryDemo";

// ISR : la landing reste cachée/statique mais se régénère toutes les 10 min
// pour refléter les tarifs édités dans /admin sans redéploiement.
export const revalidate = 600;

// Redesign 2026-06 : 16 → 12 sections. Les fusions (Journey = TwoMinutesToLive
// +HowItWorks, FeatureBento = Features+VoiceConfigShowcase, Proof =
// PerformanceShowcase+SocialProof, TrustStrip = Security compressée) suppriment
// les répétitions, pas les arguments. OutboundCalling remonte juste après la
// démo : la cible prioritaire est PME / centres d'appels / équipes de vente.
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
  return (
    <main className="noise-grain relative flex flex-col overflow-x-hidden">
      <Nav />
      <Hero />
      <IntegrationsStrip />
      <TryDemo />
      <OutboundCalling />
      <Journey />
      <FeatureBento />
      <Industries />
      <Proof />
      <Pricing pricing={pricing} />
      <TrustStrip />
      <FAQ />
      <CTA />
      <Footer />
      <SupportFab />
    </main>
  );
}
