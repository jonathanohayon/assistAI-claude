import type { ReactNode } from "react";

import type { ConnectDiagramCopy } from "@/lib/marketing/home-content";

import { Reveal } from "../Reveal";

type Tone = "light" | "dark";

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

/**
 * Colours per surface. Light (the /connect hero, over .gradient-mesh):
 * labels #18181b, forward link #0e7490 (4.88 on #fff1f2), back link #be185d
 * (5.50). Dark (command centre): white labels, #22d3ee / #f472b6 links.
 */
const TONES: Record<
  Tone,
  { figure: string; label: string; plain: string; cyan: string; forward: string; back: string; arrow: string }
> = {
  light: {
    figure: "border-[#22d3ee]/30 bg-white/75 shadow-[0_24px_64px_-28px_rgba(190,24,93,0.35)]",
    label: "text-[#18181b]",
    plain: "border-2 border-[#cbd5e1] bg-white text-[#475569]",
    cyan: "border-2 border-[#22d3ee] bg-[#ecfeff] text-[#0e7490]",
    forward: "text-[#0e7490]",
    back: "text-[#be185d]",
    arrow: "text-[#94a3b8]",
  },
  dark: {
    figure: "border-white/10 bg-white/5",
    label: "text-white",
    plain: "border-2 border-white/25 bg-white/5 text-white",
    cyan: "border-2 border-[#22d3ee]/70 bg-[#22d3ee]/10 text-white",
    forward: "text-[#22d3ee]",
    back: "text-[#f472b6]",
    arrow: "text-white/60",
  },
};

function Actor({ icon, label, look, tone }: { icon: ReactNode; label: string; look: "plain" | "brand" | "cyan"; tone: Tone }) {
  const c = TONES[tone];
  const ring =
    look === "brand"
      ? // Tamara: the brand signature, magenta → rose with the cyan ring.
        "bg-gradient-to-br from-[#be185d] to-[#db2777] text-white ring-4 ring-[#22d3ee]/40 shadow-[0_12px_32px_-10px_rgba(236,72,153,0.6)]"
      : look === "cyan"
        ? c.cyan
        : c.plain;
  return (
    <div className="flex shrink-0 flex-col items-center gap-2.5">
      <span className={`flex h-16 w-16 items-center justify-center rounded-full ${ring}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden>
          {icon}
        </svg>
      </span>
      <span className={`text-center text-sm font-semibold ${c.label}`}>{label}</span>
    </div>
  );
}

/**
 * A two-way link between two actors. Horizontal from `sm` (mirrored in RTL,
 * where the flow runs right to left), vertical on phones. The first arrow
 * points toward the next actor, the second one back.
 */
function Link2({ forward, back, tone }: { forward: string; back?: string; tone: Tone }) {
  const c = TONES[tone];
  return (
    <div className="flex flex-1 items-center justify-center gap-3 py-1 sm:flex-col sm:gap-1 sm:px-1 sm:pb-8">
      <span className={`text-[11px] font-semibold uppercase tracking-wider ${c.forward}`}>{forward}</span>
      {/* Phone: vertical arrows (down = toward the next actor). */}
      <svg viewBox="0 0 24 56" className={`h-14 w-6 sm:hidden ${c.arrow}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 4v46M4 46l4 5 4-5" />
        {back ? <path d="M16 52V6M12 10l4-5 4 5" /> : null}
      </svg>
      {/* sm+: horizontal arrows, mirrored in RTL. */}
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={`hidden h-6 w-full min-w-16 sm:block rtl:-scale-x-100 ${c.arrow}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" aria-hidden>
        <path d="M2 7h94M91 3l5 4-5 4" vectorEffect="non-scaling-stroke" />
        {back ? <path d="M98 17H4M9 13l-5 4 5 4" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {back ? <span className={`text-[11px] font-semibold uppercase tracking-wider ${c.back}`}>{back}</span> : null}
    </div>
  );
}

/**
 * The three-actor diagram (caller → Tamara → your agent), usable on any
 * surface: the caller talks to Tamara; Tamara asks the customer's agent and
 * says its answer. It is the /connect hero's visual; the sample request and
 * reply live in the contract section.
 */
export function ConnectDiagram({ copy, tone = "light" }: { copy: ConnectDiagramCopy; tone?: Tone }) {
  const { actors, links } = copy;
  return (
    <Reveal>
      <figure className={`rounded-[2rem] border px-5 py-8 backdrop-blur-xl sm:px-8 ${TONES[tone].figure}`}>
        <figcaption className="sr-only">{copy.caption}</figcaption>
        <div aria-hidden className="flex flex-col items-center sm:flex-row sm:items-center">
          <Actor icon={ICON.caller} label={actors.caller} look="plain" tone={tone} />
          <Link2 forward={links.voice} tone={tone} />
          <Actor icon={ICON.tamara} label={actors.tamara} look="brand" tone={tone} />
          <Link2 forward={links.ask} back={links.answer} tone={tone} />
          <Actor icon={ICON.agent} label={actors.agent} look="cyan" tone={tone} />
        </div>
      </figure>
    </Reveal>
  );
}
