import type { ReactNode } from "react";

import type { ConnectDiagramCopy } from "@/lib/marketing/home-content";

import { Reveal } from "../Reveal";
import { SectionHeader } from "./SectionHeader";

const ICON = {
  caller: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  tamara: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  agent: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" />
    </>
  ),
};

function Actor({ icon, label, accent }: { icon: ReactNode; label: string; accent: "plain" | "brand" | "cyan" }) {
  const ring =
    accent === "brand"
      ? "bg-gradient-to-br from-[#be185d] to-[#db2777] ring-4 ring-[#22d3ee]/40 shadow-[0_12px_32px_-10px_rgba(236,72,153,0.6)]"
      : accent === "cyan"
        ? "border-2 border-[#22d3ee]/70 bg-[#22d3ee]/10"
        : "border-2 border-white/25 bg-white/5";
  return (
    <div className="flex shrink-0 flex-col items-center gap-2.5">
      <span className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${ring}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden>
          {icon}
        </svg>
      </span>
      <span className="text-center text-sm font-semibold text-white">{label}</span>
    </div>
  );
}

/**
 * A two-way link between two actors. Horizontal from `sm` (mirrored in RTL,
 * where the flow runs right to left), vertical on phones. The first arrow
 * points toward the next actor, the second one back.
 */
function Link2({ forward, back }: { forward: string; back?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-3 py-1 sm:flex-col sm:gap-1 sm:px-1 sm:pb-8">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#22d3ee] sm:order-none">{forward}</span>
      {/* Phone: vertical arrows (down = toward the next actor). */}
      <svg viewBox="0 0 24 56" className="h-14 w-6 text-white/60 sm:hidden" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 4v46M4 46l4 5 4-5" />
        {back ? <path d="M16 52V6M12 10l4-5 4 5" /> : null}
      </svg>
      {/* sm+: horizontal arrows, mirrored in RTL. */}
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="hidden h-6 w-full min-w-16 text-white/60 sm:block rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" aria-hidden>
        <path d="M2 7h94M91 3l5 4-5 4" vectorEffect="non-scaling-stroke" />
        {back ? <path d="M98 17H4M9 13l-5 4 5 4" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {back ? <span className="text-[11px] font-semibold uppercase tracking-wider text-[#f472b6]">{back}</span> : null}
    </div>
  );
}

/**
 * /connect visual: the caller talks to Tamara; Tamara asks the customer's
 * agent and says its answer. The sample request and reply are in the contract section.
 */
export function ConnectDiagram({ copy }: { copy: ConnectDiagramCopy }) {
  const { actors, links } = copy;
  return (
    <section
      id="flow"
      aria-labelledby="flow-title"
      className="relative overflow-hidden bg-gradient-to-b from-[#2e3d55] via-[#2a374c] to-[#243043] py-24 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute start-[-12%] top-[10%] h-[28rem] w-[28rem] rounded-full bg-[#db2777]/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-[5%] end-[-10%] h-96 w-96 rounded-full bg-[#22d3ee]/20 blur-3xl" />
      <div className="relative mx-auto w-full max-w-6xl px-6">
        <SectionHeader heading={copy} id="flow-title" tone="dark" />
        {/* The diagram only: the sample request and reply live in the contract section (VP review). */}
        <div className="mx-auto mt-14 w-full max-w-3xl">
          <Reveal>
            <figure className="rounded-[2rem] border border-white/10 bg-white/5 px-5 py-8 backdrop-blur-xl sm:px-8">
              <figcaption className="sr-only">{copy.subtitle}</figcaption>
              <div aria-hidden className="flex flex-col items-center sm:flex-row sm:items-center">
                <Actor icon={ICON.caller} label={actors.caller} accent="plain" />
                <Link2 forward={links.voice} />
                <Actor icon={ICON.tamara} label={actors.tamara} accent="brand" />
                <Link2 forward={links.ask} back={links.answer} />
                <Actor icon={ICON.agent} label={actors.agent} accent="cyan" />
              </div>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
