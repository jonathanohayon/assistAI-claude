import { Stagger, StaggerItem } from "../Reveal";

/**
 * Three operating facts right under a landing hero (on the home, this slot
 * holds IntegrationsStrip). Facts only: no customer result, no price.
 */
export function FactStrip({ label, facts }: { label: string; facts: readonly string[] }) {
  return (
    <section aria-label={label} className="relative border-y border-[#22d3ee]/20 bg-white/80 backdrop-blur">
      <Stagger className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-6">
          {facts.map((fact) => (
            <li key={fact}>
              <StaggerItem className="flex items-center gap-3 sm:justify-center">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] text-white ring-2 ring-[#22d3ee]/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-base font-semibold text-[#18181b]">{fact}</span>
              </StaggerItem>
            </li>
          ))}
        </ul>
      </Stagger>
    </section>
  );
}
