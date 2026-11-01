"use client";

import { useTranslations } from "next-intl";
import { Reveal, Stagger, StaggerItem } from "./Reveal";

// Customer-facing integrations that exist in the product. Infrastructure
// suppliers are not "integrations" and are not named on public pages.
const LOGOS = [
  "GOOGLE CALENDAR",
  "GOOGLE SHEETS",
  "GMAIL",
  "WHATSAPP BUSINESS",
];

function LogosMarquee({ label }: { label: string }) {
  return (
    <div className="mt-20">
      <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      {/* dir="ltr" : le track est animé translateX(0→-50%). En RTL le
       *  conteneur ancre le track à droite → la translation vers la gauche
       *  vidait le marquee la moitié du cycle sur /he. Les logos sont
       *  latins, on force LTR sur ce bloc uniquement. */}
      <div
        dir="ltr"
        className="group relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
        }}
      >
        <div className="marquee-track flex w-max gap-12 py-2">
          {[...LOGOS, ...LOGOS].map((logo, i) => (
            <span
              key={`${logo}-${i}`}
              className="select-none whitespace-nowrap font-display text-lg tracking-[0.18em] text-slate-400/80 transition-colors duration-300 hover:text-[#BE185D]"
            >
              {logo}
            </span>
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes scroll-x {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        .marquee-track {
          animation: scroll-x 30s linear infinite;
        }
        .group:hover .marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

// Product facts only: each one is true for every account and checkable on a
// single call. Traction figures come back when they are measured.
const FACTS = ["languages", "availability", "recap"] as const;

export function Proof() {
  const tPerf = useTranslations("Performance");
  const tSocial = useTranslations("SocialProof");



  return (
    <section
      id="performance"
      className="relative overflow-hidden bg-gradient-to-b from-[#FAF7F2] via-white to-[#FFF1F2] py-24 sm:py-32"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -start-32 top-24 -z-10 h-80 w-80 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.25) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -end-32 top-1/3 -z-10 h-96 w-96 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(190,24,93,0.18) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* ── 1. Header ─────────────────────────────────────────────── */}
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0E7490]">
            {tPerf("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181B] sm:text-5xl lg:text-6xl">
            {tPerf("title")}{" "}
            <span className="bg-gradient-to-r from-[#BE185D] via-[#DB2777] to-[#FB7185] bg-clip-text text-transparent">
              {tPerf("titleHighlight")}
            </span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#475569] sm:text-lg">
            {tPerf("subtitle")}
          </p>
        </Reveal>

        {/* ── 2. Langues natives ──────────────────────────────────────
            No accuracy percentages: none has been measured. The card states
            what the product does, which a visitor can check on a call. */}
        <Reveal className="mx-auto mt-14 max-w-3xl">
          <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-slate-900/[0.04] backdrop-blur-xl sm:p-8">
            <h3 className="font-display text-xl tracking-tight text-[#18181B] sm:text-2xl">
              {tPerf("pillar3.title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#475569]">
              {tPerf("pillar3.subtitle")}
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {(["fr", "he", "en"] as const).map((lang) => (
                <li
                  key={lang}
                  className="rounded-full bg-[#FFF1F2] px-3.5 py-1.5 text-sm font-medium text-[#BE185D] ring-1 ring-inset ring-[#FBCFE8]"
                >
                  {tPerf(`pillar3.langs.${lang}`)}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* ── 3. Faits vérifiables ──────────────────────────────────── */}
        <Stagger className="mt-20 grid grid-cols-1 gap-10 border-y border-slate-200/70 py-10 sm:grid-cols-3">
          {FACTS.map((key) => (
            <StaggerItem key={key}>
              <p className="font-display text-4xl tracking-tight text-[#BE185D] sm:text-5xl">
                <bdi>{tSocial(`facts.${key}.value`)}</bdi>
              </p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {tSocial(`facts.${key}.label`)}
              </p>
            </StaggerItem>
          ))}
        </Stagger>

        {/* ── 6. Logos marquee ──────────────────────────────────────── */}
        <LogosMarquee label={tSocial("trustLabel")} />
      </div>
    </section>
  );
}
