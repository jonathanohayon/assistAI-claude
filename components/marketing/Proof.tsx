"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { EASE, Reveal, Stagger, StaggerItem } from "./Reveal";

/* ------------------------------------------------------------------ */
/*  Count-up helper — small animated number that ticks on inView      */
/* ------------------------------------------------------------------ */

function CountUp({
  value,
  decimals = 0,
  duration = 1.6,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const mv = useMotionValue(0);
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(
    decimals > 0 ? (0).toFixed(decimals) : "0",
  );

  useEffect(() => {
    // En reduced-motion on n'anime pas : la valeur finale est dérivée au
    // render (voir `shown` ci-dessous), pas besoin d'effect.
    if (!inView || reduce) return;
    const controls = animate(mv, value, {
      duration,
      ease: EASE,
      onUpdate: (latest) => {
        setDisplay(latest.toFixed(decimals));
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, duration, mv, reduce]);

  // prefers-reduced-motion → affiche directement la valeur finale.
  const shown = reduce && inView ? value.toFixed(decimals) : display;

  return (
    <span ref={ref}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Duel Metric — dueling gauges (standard vs Tamara)                  */
/*  Fills animés en scaleX (transform-only, RTL-safe via origin)       */
/* ------------------------------------------------------------------ */

function DuelMetric({
  label,
  leftDisplay,
  rightValue,
  rightDecimals = 0,
  unit = "",
  leftPct,
  rightPct,
  callout,
  delay = 0,
  standardLabel,
  tamaraLabel,
}: {
  label: string;
  leftDisplay: string;
  rightValue: number;
  rightDecimals?: number;
  unit?: string;
  leftPct: number;
  rightPct: number;
  callout: string;
  delay?: number;
  standardLabel: string;
  tamaraLabel: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: EASE }}
      className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm backdrop-blur-md sm:p-6"
    >
      {/* Glow tag — coin haut/fin de ligne */}
      <span className="absolute end-4 top-4 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#BE185D] to-[#EC4899] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow">
        {callout}
      </span>

      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </p>

      {/* Standard row */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {standardLabel}
          </span>
          <span className="text-xs font-semibold text-slate-500 line-through decoration-slate-300/80">
            {leftDisplay}
          </span>
        </div>
        <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="absolute inset-y-0 start-0 origin-left rounded-full bg-slate-300 rtl:origin-right"
            style={{ width: `${leftPct}%` }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={reduce ? undefined : { scaleX: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1.0, delay: delay + 0.1, ease: EASE }}
          />
        </div>
      </div>

      {/* Tamara row */}
      <div className="mt-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#BE185D]">
            {tamaraLabel}
          </span>
          <span className="font-display text-xl font-bold tabular-nums text-[#BE185D] sm:text-2xl">
            <CountUp
              value={rightValue}
              decimals={rightDecimals}
              suffix={unit}
              duration={1.4}
            />
          </span>
        </div>
        <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="absolute inset-y-0 start-0 origin-left rounded-full rtl:origin-right"
            style={{
              width: `${rightPct}%`,
              background:
                "linear-gradient(90deg,#BE185D 0%,#EC4899 60%,#FB7185 100%)",
              boxShadow: "0 0 12px rgba(190,24,93,0.45)",
            }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={reduce ? undefined : { scaleX: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1.4, delay: delay + 0.3, ease: EASE }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated horizontal bar — multilingual accuracy                    */
/* ------------------------------------------------------------------ */

function AccuracyBar({
  label,
  value,
  highlight = false,
  delay = 0,
  isRTL = false,
  highlightBadge,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  delay?: number;
  isRTL?: boolean;
  highlightBadge?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span
          dir={isRTL ? "rtl" : "ltr"}
          className={`text-sm font-semibold ${
            highlight ? "text-[#BE185D]" : "text-[#18181B]"
          }`}
        >
          {label}
          {highlight && highlightBadge ? (
            <span className="ms-2 inline-flex items-center rounded-full bg-[#BE185D]/10 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-[#BE185D]">
              {highlightBadge}
            </span>
          ) : null}
        </span>
        <span className="font-display text-base tabular-nums text-[#0E7490]">
          <CountUp value={value} decimals={1} suffix="%" />
        </span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="absolute inset-y-0 start-0 origin-left rounded-full rtl:origin-right"
          style={{
            width: `${value}%`,
            background: highlight
              ? "linear-gradient(90deg,#BE185D 0%,#EC4899 60%,#FB7185 100%)"
              : "linear-gradient(90deg,#0E7490 0%,#22D3EE 100%)",
          }}
          initial={reduce ? false : { scaleX: 0 }}
          whileInView={reduce ? undefined : { scaleX: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 1.4, delay, ease: EASE }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Big stat — count-up FR-formatted                                   */
/* ------------------------------------------------------------------ */

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
      ease: EASE,
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
        {suffix ? (
          <span className="ms-1 text-3xl sm:text-4xl">{suffix}</span>
        ) : null}
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

        {/* ── 2. Duel de métriques (latence + précision) ────────────── */}
        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          <DuelMetric
            label={tPerf("pillar1.metrics.latency.label")}
            leftDisplay="~800 ms"
            rightValue={280}
            unit=" ms"
            leftPct={35}
            rightPct={92}
            callout="3× +"
            delay={0.0}
            standardLabel={tPerf("pillar1.metrics.standardLabel")}
            tamaraLabel={tPerf("pillar1.metrics.tamaraLabel")}
          />
          <DuelMetric
            label={tPerf("pillar1.metrics.accuracy.label")}
            leftDisplay="87 %"
            rightValue={98.4}
            rightDecimals={1}
            unit=" %"
            leftPct={87}
            rightPct={98.4}
            callout="+11 pts"
            delay={0.08}
            standardLabel={tPerf("pillar1.metrics.standardLabel")}
            tamaraLabel={tPerf("pillar1.metrics.tamaraLabel")}
          />
        </div>

        {/* ── 3. Précision multilangue ──────────────────────────────── */}
        <Reveal className="mx-auto mt-12 max-w-3xl">
          <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-slate-900/[0.04] backdrop-blur-xl sm:p-8">
            <h3 className="font-display text-xl tracking-tight text-[#18181B] sm:text-2xl">
              {tPerf("pillar3.title")}
            </h3>
            <div className="mt-6 flex flex-col gap-5">
              <AccuracyBar
                label={tPerf("pillar3.langs.fr")}
                value={98.7}
                delay={0.0}
              />
              <AccuracyBar
                label={tPerf("pillar3.langs.he")}
                value={98.4}
                highlight
                delay={0.15}
                isRTL
                highlightBadge={tPerf("pillar3.unprecedentedBadge")}
              />
              <AccuracyBar
                label={tPerf("pillar3.langs.en")}
                value={99.1}
                delay={0.3}
              />
            </div>
            <p className="mt-6 text-[11px] italic text-[#94A3B8]">
              {tPerf("pillar3.footnote")}
            </p>
          </div>
        </Reveal>

        {/* ── 4. Bande de stats (traction) ──────────────────────────── */}
        <Stagger className="mt-20 grid grid-cols-1 gap-10 border-y border-slate-200/70 py-10 sm:grid-cols-3">
          <StaggerItem>
            <Stat value={127} label={STATS_LABELS.salons} delay={0} />
          </StaggerItem>
          <StaggerItem>
            <Stat value={23410} label={STATS_LABELS.calls} delay={0.1} />
          </StaggerItem>
          <StaggerItem>
            <Stat
              value={184}
              suffix="min"
              label={STATS_LABELS.minutes}
              delay={0.2}
            />
          </StaggerItem>
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
        <LogosMarquee label={STATS_LABELS.trust} />
      </div>
    </section>
  );
}
