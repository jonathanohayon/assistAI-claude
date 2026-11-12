import Link from "next/link";
import type { ReactNode } from "react";

import { EMPHASIS_SLOT, heroTitleTokens } from "@/lib/hero-title";
import type { DoorHeroSlot } from "@/lib/marketing/home-content";

import { CampaignPanel } from "../CampaignPanel";
import { COMMAND_CENTRE_BG, CommandCentreGlows } from "../CommandCentre";

type Tone = "dark" | "light";

/** Each door's surface: the visual decides it (the campaign card is a dark card). */
const TONE: Record<DoorHeroSlot["media"], Tone> = {
  panel: "dark",
};

/**
 * Colours per surface. Contrast (WCAG), computed on the surface's stops:
 * - dark (#2e3d55 → #243043): white 10.97–13.30; emphasis #f472b6 4.14–5.02
 *   (large text, AA needs 3); badge #22d3ee 7.0+.
 * - light (#fff1f2 under .gradient-mesh): body #475569 6.90; title #18181b
 *   16.13; emphasis #be185d 5.50; badge #0e7490 4.88.
 * White text sits only on the dark surface, or on the #be185d → #db2777
 * button (4.60–6.04).
 */
const TONES: Record<
  Tone,
  { badge: string; dot: string; title: string; emphasis: string; trailing: string; body: string; secondary: string }
> = {
  dark: {
    badge: "border-[#22d3ee]/30 bg-white/5 text-[#22d3ee]",
    dot: "bg-[#22d3ee]",
    title: "text-white",
    emphasis: "text-[#f472b6]",
    trailing: "text-white",
    body: "text-white/80",
    secondary: "border-[#22d3ee]/70 bg-[#22d3ee]/15 text-white hover:border-[#22d3ee] hover:bg-[#22d3ee]/25",
  },
  light: {
    badge: "border-[#22d3ee]/40 bg-white/80 text-[#0e7490] shadow-sm",
    dot: "bg-[#22d3ee]",
    title: "text-[#18181b]",
    emphasis: "text-[#be185d]",
    trailing: "text-[#18181b]",
    body: "text-[#475569]",
    secondary: "border-[#22d3ee]/70 bg-white/80 text-[#0e7490] hover:border-[#22d3ee] hover:bg-white",
  },
};

function Visual({ slot }: { slot: DoorHeroSlot }): ReactNode {
  switch (slot.media) {
    case "panel":
      return <CampaignPanel />;
  }
}

/**
 * A landing page's hero (its "door"): no video. Copy on the start side (left,
 * right in RTL), the page's own visual on the end side, below the copy on
 * phones. The home keeps its video hero (Hero.tsx); this one is static: the
 * only motion is the visual's own (the campaign card dialling), which honours
 * reduced motion.
 */
export function DoorHero(slot: DoorHeroSlot) {
  const { copy } = slot;
  const tone = TONE[slot.media];
  const c = TONES[tone];
  const tokens = heroTitleTokens(copy.title.replace("{emphasis}", EMPHASIS_SLOT), copy.emphasis ?? "");

  return (
    <section
      aria-labelledby="hero-title"
      className={`relative isolate overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28 lg:flex lg:min-h-[88vh] lg:items-center ${
        tone === "dark" ? COMMAND_CENTRE_BG : ""
      }`}
    >
      {tone === "dark" ? (
        <CommandCentreGlows />
      ) : (
        // The site's light brand mesh (login, sign-up) over the page background.
        <div aria-hidden className="gradient-mesh pointer-events-none absolute inset-0 -z-10" />
      )}

      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 text-start lg:col-span-6">
          <p
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] backdrop-blur ${c.badge}`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
            {copy.badge}
          </p>

          <h1
            id="hero-title"
            className={`mt-6 font-display text-[2.75rem] leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.25rem] ${c.title}`}
          >
            {tokens.map((tok, i) => (
              <span key={i} className="me-[0.22em] inline-block">
                {tok.emphasis ? (
                  <span className={`relative inline-block ${c.emphasis}`}>
                    {tok.text}
                    {tok.trailing ? <span className={c.trailing}>{tok.trailing}</span> : null}
                    {/* The home's brush underline (magenta → rose), static here. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 -bottom-1 h-[5px] rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#f472b6]"
                    />
                  </span>
                ) : (
                  tok.text
                )}
              </span>
            ))}
          </h1>

          <p className={`mt-6 max-w-xl text-base leading-relaxed sm:text-lg ${c.body}`}>{copy.subtitle}</p>

          <div
            className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
            // The WhatsApp FAB hides while this row is on screen on mobile
            // (components/marketing/SupportFab).
            data-fab-avoid=""
          >
            <Link
              href={copy.primary.href}
              className="group relative inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] px-8 py-4 text-base font-semibold text-white shadow-[0_10px_30px_-10px_rgba(190,24,93,0.55)] ring-2 ring-[#22d3ee]/40 transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee] active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              <span>{copy.primary.label}</span>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 rtl:rotate-180" aria-hidden>
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href={copy.secondary.href}
              className={`inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border-2 px-7 py-4 text-base font-semibold backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee]/70 ${c.secondary}`}
            >
              {copy.secondary.label}
            </Link>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-6">
          <Visual slot={slot} />
        </div>
      </div>
    </section>
  );
}
