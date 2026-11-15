import type { SectionHeading } from "@/lib/marketing/home-content";

import { Reveal } from "../Reveal";

/** The landing sections' heading: same kicker / display title / lead as the
 *  home's FAQ and Pricing headings, so the pages read as siblings. */
export function SectionHeader({
  heading,
  id,
  tone = "light",
}: {
  heading: SectionHeading;
  /** id of the h2 (the section's aria-labelledby). */
  id: string;
  tone?: "light" | "dark";
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p
        className={`text-xs font-semibold uppercase tracking-widest ${
          tone === "dark" ? "text-[#22d3ee]" : "text-[#0e7490]"
        }`}
      >
        {heading.kicker}
      </p>
      <h2
        id={id}
        className={`mt-3 font-display text-4xl tracking-tight sm:text-5xl ${
          tone === "dark" ? "text-white" : "text-[#be185d]"
        }`}
      >
        {heading.title}
      </h2>
      {heading.subtitle ? (
        <p
          className={`mt-5 text-base leading-relaxed sm:text-lg ${
            tone === "dark" ? "text-white/75" : "text-slate-600"
          }`}
        >
          {heading.subtitle}
        </p>
      ) : null}
    </Reveal>
  );
}
