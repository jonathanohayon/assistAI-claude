import type { ItemCopy, SectionHeading } from "@/lib/marketing/home-content";

import { Stagger, StaggerItem } from "../Reveal";
import { SectionHeader } from "./SectionHeader";

/** Use cases of a landing page: illustrations of what the agent is for,
 *  never customer results. */
export function LandingUseCases({ items, ...heading }: SectionHeading & { items: readonly ItemCopy[] }) {
  return (
    <section id="use-cases" aria-labelledby="use-cases-title" className="relative bg-white py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeader heading={heading} id="use-cases-title" />
        <Stagger className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {items.map((item) => (
            <StaggerItem key={item.title} className="h-full">
              <div className="h-full rounded-e-2xl border-s-4 border-[#db2777] bg-[#faf7f2] px-6 py-6">
                <h3 className="font-display text-2xl tracking-tight text-[#18181b]">{item.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-[#475569]">{item.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
