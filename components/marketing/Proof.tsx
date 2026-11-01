"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { EASE, Reveal, Stagger, StaggerItem } from "./Reveal";

/* --------------------------- avatar (initial) --------------------------- */

const AVATAR_GRADIENTS = [
  "from-[#BE185D] to-[#F472B6]", // magenta → rose
  "from-[#0E7490] to-[#22D3EE]", // teal → cyan
  "from-[#F97316] to-[#FBBF24]", // orange → amber
];

function Avatar({ name, idx }: { name: string; idx: number }) {
  const initial =
    name
      .replace(/^(Dr\.|Salon|Studio)\s+/i, "")
      .trim()
      .charAt(0)
      .toUpperCase() || "•";
  return (
    <motion.div
      whileHover={{ scale: 1.08 }}
      transition={{ type: "spring", stiffness: 320, damping: 20 }}
      className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]} font-display text-2xl text-white shadow-lg ring-2 ring-white transition-shadow hover:ring-4 hover:ring-cyan-300/40`}
      aria-hidden
    >
      {initial}
    </motion.div>
  );
}

/* -------------------------- kinetic pull-quote -------------------------- */

function KineticQuote({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  if (reduce) {
    return (
      <span className="font-display text-[26px] italic leading-[1.2] text-[#BE185D] sm:text-[30px]">
        {text}
      </span>
    );
  }
  return (
    <motion.span
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      transition={{ staggerChildren: 0.04 }}
      className="font-display text-[26px] italic leading-[1.2] text-[#BE185D] sm:text-[30px]"
    >
      {words.map((w, i) => (
        <motion.span
          key={i}
          variants={{
            hidden: { opacity: 0, y: 8 },
            visible: { opacity: 1, y: 0 },
          }}
          transition={{ duration: 0.5, ease: EASE }}
          className="inline-block"
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </motion.span>
  );
}

/* ------------------------------ logos ----------------------------------- */

const LOGOS = [
  "DOCTOLIB",
  "TWILIO",
  "GOOGLE CALENDAR",
  "LIVEKIT",
  "OPENAI",
  "STRIPE",
  "WHATSAPP BUSINESS",
  "VERCEL",
  "SUPABASE",
  "AI-COUSTICS",
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

/* ------------------------------- cards ----------------------------------- */

type Quote = { text: string; author: string; role: string };

function FeaturedCard({ quote, idx }: { quote: Quote; idx: number }) {
  return (
    <motion.figure
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.7, ease: EASE }}
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-[2rem] border border-[#BE185D]/15 bg-white/70 p-8 shadow-[0_30px_80px_-40px_rgba(190,24,93,0.35)] backdrop-blur-xl sm:p-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-[#BE185D]/10 blur-3xl"
      />
      <svg
        viewBox="0 0 32 24"
        fill="none"
        aria-hidden
        className="mb-6 h-10 w-10 text-[#BE185D]/30"
      >
        <path
          d="M0 24V12C0 5.4 4.5 1 12 0v6c-3 1-4.5 3-4.5 6H12v12H0Zm20 0V12C20 5.4 24.5 1 32 0v6c-3 1-4.5 3-4.5 6H32v12H20Z"
          fill="currentColor"
        />
      </svg>
      <blockquote className="relative">
        <KineticQuote text={quote.text} />
      </blockquote>
      <figcaption className="mt-8 flex items-center gap-4 border-t border-[#BE185D]/10 pt-6">
        <Avatar name={quote.author} idx={idx} />
        <div className="min-w-0">
          <p className="font-display text-base text-slate-900">
            {quote.author}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E7490]">
            {quote.role}
          </p>
        </div>
      </figcaption>
    </motion.figure>
  );
}

function CompactCard({ quote, idx }: { quote: Quote; idx: number }) {
  return (
    <motion.figure
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.6, ease: EASE }}
      className="relative rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.25)] backdrop-blur"
    >
      <blockquote className="font-display text-[17px] italic leading-snug text-slate-800">
        <span className="text-[#BE185D]">“</span>
        {quote.text}
        <span className="text-[#BE185D]">”</span>
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <div className="origin-left scale-75 rtl:origin-right">
          <Avatar name={quote.author} idx={idx} />
        </div>
        <div className="-ms-2 min-w-0">
          <p className="text-sm font-medium text-slate-900">{quote.author}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0E7490]">
            {quote.role}
          </p>
        </div>
      </figcaption>
    </motion.figure>
  );
}

/* ================================================================== */
/*  Public component — Proof : performance + traction + témoignages   */
/* ================================================================== */

// Product facts only: each one is true for every account and checkable on a
// single call. Traction figures come back when they are measured.
const FACTS = ["languages", "availability", "recap"] as const;

export function Proof() {
  const tPerf = useTranslations("Performance");
  const tSocial = useTranslations("SocialProof");

  const QUOTES: Quote[] = [
    {
      text: tSocial("q1.text"),
      author: tSocial("q1.author"),
      role: tSocial("q1.role"),
    },
    {
      text: tSocial("q2.text"),
      author: tSocial("q2.author"),
      role: tSocial("q2.role"),
    },
    {
      text: tSocial("q3.text"),
      author: tSocial("q3.author"),
      role: tSocial("q3.role"),
    },
  ];


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

        {/* ── 5. Témoignages — layout asymétrique 3 + 2 ─────────────── */}
        <div id="testimonials" className="mt-20 scroll-mt-24">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#BE185D]">
              {tSocial("kicker")}
            </p>
            <h3 className="mt-3 font-display text-3xl tracking-tight text-slate-900 sm:text-4xl">
              {tSocial("title")}
            </h3>
          </Reveal>

          <Stagger className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <FeaturedCard quote={QUOTES[0]} idx={0} />
            </div>
            <div className="flex flex-col gap-6 lg:col-span-2">
              <CompactCard quote={QUOTES[1]} idx={1} />
              <CompactCard quote={QUOTES[2]} idx={2} />
            </div>
          </Stagger>
        </div>

        {/* ── 6. Logos marquee ──────────────────────────────────────── */}
        <LogosMarquee label={tSocial("trustLabel")} />
      </div>
    </section>
  );
}
