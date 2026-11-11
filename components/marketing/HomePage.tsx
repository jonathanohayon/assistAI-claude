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
import { Nav } from "./Nav";
import { Pricing } from "./Pricing";
import { Proof } from "./Proof";
import { RespectReducedMotion } from "./RespectReducedMotion";
import { SupportFab } from "./SupportFab";
import { TrustStrip } from "./TrustStrip";
import { TryDemo } from "./TryDemo";

type SlotContext = { pricing: PlanPricingMap };

/** One renderer per slot. The mapped type makes it exhaustive: a new slot in
 *  HomeContent does not compile until it has a renderer here. */
const RENDERERS: {
  [K in HomeSlotId]: (slot: NonNullable<HomeContent[K]>, ctx: SlotContext) => ReactNode;
} = {
  hero: (slot) => <Hero stats={slot.stats} />,
  proofStrip: () => <IntegrationsStrip />,
  demo: (slot) => <TryDemo demo={slot.demo} />,
  how: () => <Journey />,
  features: () => <FeatureBento />,
  useCases: () => <Industries />,
  proof: () => <Proof />,
  pricing: (_slot, ctx) => <Pricing pricing={ctx.pricing} />,
  trust: () => <TrustStrip />,
  faq: (slot) => <FAQ faqKeys={slot.keys} />,
  cta: () => <CTA />,
};

function renderSlot<K extends HomeSlotId>(id: K, content: HomeContent, ctx: SlotContext) {
  const slot = content[id];
  if (!slot) return null;
  return <Fragment key={id}>{RENDERERS[id](slot as NonNullable<HomeContent[K]>, ctx)}</Fragment>;
}

/**
 * The public home page, rendered from a content object: Nav, the filled
 * slots in HOME_SLOT_ORDER, then Footer and the support button.
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
        <Nav />
        {HOME_SLOT_ORDER.map((id) => renderSlot(id, content, ctx))}
        <Footer />
        <SupportFab />
      </main>
    </RespectReducedMotion>
  );
}
