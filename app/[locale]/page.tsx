import { setRequestLocale } from "next-intl/server";

import { CTA } from "@/components/marketing/CTA";
import { Features } from "@/components/marketing/Features";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Industries } from "@/components/marketing/Industries";
import { Nav } from "@/components/marketing/Nav";
import { Pricing } from "@/components/marketing/Pricing";
import { SocialProof } from "@/components/marketing/SocialProof";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="relative flex flex-col overflow-x-hidden">
      <Nav />
      <Hero />
      <Industries />
      <HowItWorks />
      <Features />
      <Pricing />
      <SocialProof />
      <CTA />
      <Footer />
    </main>
  );
}
