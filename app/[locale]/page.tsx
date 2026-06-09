import { setRequestLocale } from "next-intl/server";

import { DEFAULT_PLAN_PRICING, type PlanPricingMap } from "@/lib/plan-pricing";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { CTA } from "@/components/marketing/CTA";
import { FAQ } from "@/components/marketing/FAQ";
import { Features } from "@/components/marketing/Features";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Industries } from "@/components/marketing/Industries";
import { Nav } from "@/components/marketing/Nav";
import { OutboundCalling } from "@/components/marketing/OutboundCalling";
import { PerformanceShowcase } from "@/components/marketing/PerformanceShowcase";
import { Pricing } from "@/components/marketing/Pricing";
import { Security } from "@/components/marketing/Security";
import { SocialProof } from "@/components/marketing/SocialProof";
import { SupportFab } from "@/components/marketing/SupportFab";
import { TryDemo } from "@/components/marketing/TryDemo";
import { TwoMinutesToLive } from "@/components/marketing/TwoMinutesToLive";
import { VoiceConfigShowcase } from "@/components/marketing/VoiceConfigShowcase";

// ISR : la landing reste cachée/statique mais se régénère toutes les 10 min
// pour refléter les tarifs édités dans /admin sans redéploiement.
export const revalidate = 600;

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
      <TryDemo />
      <TwoMinutesToLive />
      <Industries />
      <HowItWorks />
      <VoiceConfigShowcase />
      <OutboundCalling />
      <PerformanceShowcase />
      <Features />
      <Pricing pricing={pricing} />
      <SocialProof />
      <Security />
      <FAQ />
      <CTA />
      <Footer />
      <SupportFab />
    </main>
  );
}
