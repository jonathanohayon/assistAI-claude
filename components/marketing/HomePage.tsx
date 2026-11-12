import { Fragment, type ReactNode } from "react";

import type { PlanPricingMap } from "@/lib/plan-pricing";
import {
  HOME_SLOT_ORDER,
  type HomeContent,
  type HomeSlotId,
} from "@/lib/marketing/home-content";

import { CTA } from "./CTA";
import { FAQ } from "./FAQ";
import { FeatureBento } from "./FeatureBento";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { Industries } from "./Industries";
import { IntegrationsStrip } from "./IntegrationsStrip";
import { Journey } from "./Journey";
import { FactStrip } from "./landing/FactStrip";
import { LandingSteps } from "./landing/LandingSteps";
import { LandingUseCases } from "./landing/LandingUseCases";
import { SixModules } from "./landing/SixModules";
import { TalkToUs } from "./landing/TalkToUs";
import { Nav } from "./Nav";
import { OutboundCalling } from "./OutboundCalling";
import { Pricing } from "./Pricing";
import { Proof } from "./Proof";
import { RespectReducedMotion } from "./RespectReducedMotion";
import { SupportFab } from "./SupportFab";
import { TrustStrip } from "./TrustStrip";
import { TryDemo } from "./TryDemo";

type SlotContext = { pricing: PlanPricingMap };

/** One renderer per slot. The mapped type makes it exhaustive: a new slot in
 *  HomeContent does not compile until it has a renderer here. A slot with
 *  two shapes (the home's baked component, or a landing page's copy) picks
 *  its component from the shape; the home's shape renders exactly what it
 *  did before. */
const RENDERERS: {
  [K in HomeSlotId]: (slot: NonNullable<HomeContent[K]>, ctx: SlotContext) => ReactNode;
} = {
  hero: (slot) => <Hero stats={slot.stats} copy={slot.copy} />,
  proofStrip: (slot) => ("facts" in slot ? <FactStrip label={slot.label} facts={slot.facts} /> : <IntegrationsStrip />),
  showcase: (slot) => <OutboundCalling copy={slot.copy} />,
  demo: (slot) => <TryDemo demo={slot.demo} />,
  how: (slot) => ("steps" in slot ? <LandingSteps {...slot} /> : <Journey />),
  features: () => <FeatureBento />,
  modules: (slot) => <SixModules {...slot} />,
  useCases: (slot) => ("items" in slot ? <LandingUseCases {...slot} /> : <Industries />),
  proof: () => <Proof />,
  pricing: (_slot, ctx) => <Pricing pricing={ctx.pricing} />,
  talk: (slot) => <TalkToUs {...slot} />,
  trust: () => <TrustStrip />,
  faq: (slot) => ("items" in slot ? <FAQ heading={slot} items={slot.items} /> : <FAQ faqKeys={slot.keys} />),
  cta: (slot) => ("copy" in slot ? <CTA copy={slot.copy} /> : <CTA />),
};

function renderSlot<K extends HomeSlotId>(id: K, content: HomeContent, ctx: SlotContext) {
  const slot = content[id];
  if (!slot) return null;
  return <Fragment key={id}>{RENDERERS[id](slot as NonNullable<HomeContent[K]>, ctx)}</Fragment>;
}

/**
 * The public home page, rendered from a content object: Nav, the filled
 * slots in HOME_SLOT_ORDER, then Footer and the support button. The unlisted
 * landing pages (/sales, /connect) are other content objects on this same
 * skeleton.
 */
export function HomePage({
  content,
  pricing,
}: {
  content: HomeContent;
  pricing: PlanPricingMap;
}) {
  const ctx: SlotContext = { pricing };
  return (
    <RespectReducedMotion>
      <main className="noise-grain relative flex flex-col overflow-x-hidden">
        <Nav nav={content.nav} />
        {HOME_SLOT_ORDER.map((id) => renderSlot(id, content, ctx))}
        <Footer anchorBase={content.nav ? "/" : ""} />
        <SupportFab />
      </main>
    </RespectReducedMotion>
  );
}
