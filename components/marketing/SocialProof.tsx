"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/* ----------------------------- helpers ---------------------------------- */

function formatFr(n: number) {
  // 23410 -> "23 410" (espace insécable fine)
  return Math.round(n).toLocaleString("fr-FR").replace(/,/g, " ");
}

function Stat({
  value,
  label,
  suffix,
  delay = 0,
}: {
  value: number;
  label: string;
  suffix?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState("0");
  const reduce = useReducedMotion();

  useEffect(() => {
    // En reduced-motion on n'anime pas : la valeur finale est dérivée au
    // render (voir `shown` ci-dessous), pas besoin d'effect.
    if (!inView || reduce) return;
    const controls = animate(mv, value, {
      duration: 1.8,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(formatFr(latest)),
    });
    return () => controls.stop();
  }, [inView, value, delay, mv, reduce]);

  // prefers-reduced-motion → affiche directement la valeur finale.
  const shown = reduce && inView ? formatFr(value) : display;

  return (
    <div ref={ref} className="flex flex-col items-start gap-2">
      <div className="font-display text-5xl leading-none tracking-tight text-[#BE185D] sm:text-6xl">
        {shown}
        {suffix ? <span className="ml-1 text-3xl sm:text-4xl">{suffix}</span> : null}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
    </div>
  );
}

/* --------------------------- avatar (initial) --------------------------- */

const AVATAR_GRADIENTS = [
  "from-[#BE185D] to-[#F472B6]", // magenta → rose
  "from-[#0E7490] to-[#22D3EE]", // teal → cyan
  "from-[#F97316] to-[#FBBF24]", // orange → amber
];

function Avatar({ name, idx }: { name: string; idx: number }) {
  const initial = name.replace(/^(Dr\.|Salon|Studio)\s+/i, "").trim().charAt(0).toUpperCase() || "•";
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
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
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
      <div
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

/* ------------------------------- card ----------------------------------- */

type Quote = { text: string; author: string; role: string };

function FeaturedCard({ quote, idx }: { quote: Quote; idx: number }) {
  return (
    <motion.figure
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-[2rem] border border-[#BE185D]/15 bg-white/70 p-8 shadow-[0_30px_80px_-40px_rgba(190,24,93,0.35)] backdrop-blur-xl sm:p-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#BE185D]/10 blur-3xl"
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
          <p className="font-display text-base text-slate-900">{quote.author}</p>
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
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.25)] backdrop-blur"
    >
      <blockquote className="font-display text-[17px] italic leading-snug text-slate-800">
        <span className="text-[#BE185D]">“</span>
        {quote.text}
        <span className="text-[#BE185D]">”</span>
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <div className="scale-75 origin-left">
          <Avatar name={quote.author} idx={idx} />
        </div>
        <div className="-ml-2 min-w-0">
          <p className="text-sm font-medium text-slate-900">{quote.author}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0E7490]">
            {quote.role}
          </p>
        </div>
      </figcaption>
    </motion.figure>
  );
}

/* ------------------------------ section --------------------------------- */

export function SocialProof() {
  const t = useTranslations("SocialProof");
  const QUOTES: Quote[] = [
    { text: t("q1.text"), author: t("q1.author"), role: t("q1.role") },
    { text: t("q2.text"), author: t("q2.author"), role: t("q2.role") },
    { text: t("q3.text"), author: t("q3.author"), role: t("q3.role") },
  ];

  // TODO(i18n): déplacer ces 4 libellés dans messages/{fr,en,he}.json
  // sous SocialProof.stats.{salons,calls,minutes,trustLabel}
  const STATS_LABELS = {
    salons: "Salons utilisent Tamara",
    calls: "Appels traités",
    minutes: "Minutes/jour économisées",
    trust: "Ils s'intègrent avec Tamara",
  };

  return (
    <section
      id="testimonials"
      className="relative overflow-hidden bg-gradient-to-b from-[#FAF7F2] via-white to-[#FFF1F2] py-24 sm:py-32"
    >
      {/* coral blob top-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[#fb7185]/[0.12] blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#BE185D]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-slate-900 sm:text-5xl">
            {t("title")}
          </h2>
        </motion.div>

        {/* stats band */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.12 } },
          }}
          className="mt-12 grid grid-cols-1 gap-10 border-y border-slate-200/70 py-10 sm:grid-cols-3"
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <Stat value={127} label={STATS_LABELS.salons} delay={0} />
          </motion.div>
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <Stat value={23410} label={STATS_LABELS.calls} delay={0.1} />
          </motion.div>
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <Stat
              value={184}
              suffix="min"
              label={STATS_LABELS.minutes}
              delay={0.2}
            />
          </motion.div>
        </motion.div>

        {/* testimonials — asymmetric editorial layout */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.12 } },
          }}
          className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-5"
        >
          <div className="lg:col-span-3">
            <FeaturedCard quote={QUOTES[0]} idx={0} />
          </div>
          <div className="flex flex-col gap-6 lg:col-span-2">
            <CompactCard quote={QUOTES[1]} idx={1} />
            <CompactCard quote={QUOTES[2]} idx={2} />
          </div>
        </motion.div>

        {/* logos marquee */}
        <LogosMarquee label={STATS_LABELS.trust} />
      </div>
    </section>
  );
}
