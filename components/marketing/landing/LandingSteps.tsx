import type { ItemCopy, SectionHeading } from "@/lib/marketing/home-content";

import { Stagger, StaggerItem } from "../Reveal";
import { SectionHeader } from "./SectionHeader";

/** "How it works" of a landing page: a real sequence, so numbered. */
export function LandingSteps({ steps, ...heading }: SectionHeading & { steps: readonly ItemCopy[] }) {
  return (
    <section id="how" aria-labelledby="how-title" className="relative bg-[#faf7f2] py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeader heading={heading} id="how-title" />
        <Stagger className="relative mt-14">
          {/* The thread that ties the steps (desktop): magenta → rose. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-[16%] top-7 hidden h-px bg-gradient-to-r from-[#be185d]/40 via-[#ec4899]/40 to-[#f472b6]/40 md:block"
          />
          <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {steps.map((step, i) => (
              <li key={step.title}>
                <StaggerItem className="flex flex-col items-start gap-4 md:items-center md:text-center">
                  <span
                    aria-hidden
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] font-display text-2xl text-white shadow-[0_10px_30px_-10px_rgba(190,24,93,0.55)] ring-4 ring-[#22d3ee]/30"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-extrabold leading-snug text-[#18181b] sm:text-xl">{step.title}</h3>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#475569] sm:text-base">{step.body}</p>
                  </div>
                </StaggerItem>
              </li>
            ))}
          </ol>
        </Stagger>
      </div>
    </section>
  );
}
