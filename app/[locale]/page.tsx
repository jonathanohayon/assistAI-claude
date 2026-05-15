import { setRequestLocale } from "next-intl/server";

import { CTA } from "@/components/marketing/CTA";
import { FAQ } from "@/components/marketing/FAQ";
import { Features } from "@/components/marketing/Features";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Industries } from "@/components/marketing/Industries";
import { Nav } from "@/components/marketing/Nav";
import { PerformanceShowcase } from "@/components/marketing/PerformanceShowcase";
import { Pricing } from "@/components/marketing/Pricing";
import { Security } from "@/components/marketing/Security";
import { SocialProof } from "@/components/marketing/SocialProof";
import { SupportFab } from "@/components/marketing/SupportFab";
import { TryDemo } from "@/components/marketing/TryDemo";
import { TwoMinutesToLive } from "@/components/marketing/TwoMinutesToLive";
import { VoiceConfigShowcase } from "@/components/marketing/VoiceConfigShowcase";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="noise-grain relative flex flex-col overflow-x-hidden">
      <Nav />
      <Hero />
      <TryDemo />
      <TwoMinutesToLive />
      <Industries />
      <HowItWorks />
      <VoiceConfigShowcase />
      <PerformanceShowcase />
      <Features />
      <Pricing />
      <SocialProof />
      <Security />
      <FAQ />
      <CTA />
      <Footer />
      <SupportFab />
    </main>
  );
}
