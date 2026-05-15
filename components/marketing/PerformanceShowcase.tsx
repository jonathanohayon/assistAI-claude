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
    if (!inView) return;
    if (reduce) {
      setDisplay(value.toFixed(decimals));
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        setDisplay(latest.toFixed(decimals));
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, duration, mv, reduce]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated waveform — used in noise-reduction pillar                */
/* ------------------------------------------------------------------ */

function Waveform({ tone = "cyan" }: { tone?: "cyan" | "magenta" | "coral" }) {
  const reduce = useReducedMotion();
  const color =
    tone === "magenta"
      ? "#BE185D"
      : tone === "coral"
        ? "#FB7185"
        : "#22D3EE";

  const bars = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.45, 0.7, 0.55];

  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            backgroundColor: color,
            height: `${h * 100}%`,
            transformOrigin: "bottom",
          }}
          initial={reduce ? false : { scaleY: 0.3 }}
          animate={
            reduce
              ? undefined
              : {
                  scaleY: [0.3, 1, 0.5, 0.9, 0.4, 0.8, 0.3],
                }
          }
          transition={{
            duration: 2.2,
            repeat: Infinity,
            repeatType: "loop",
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated horizontal bar for the multi-lang pillar                 */
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
            <span className="ml-2 inline-flex items-center rounded-full bg-[#BE185D]/10 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-[#BE185D]">
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
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: highlight
              ? "linear-gradient(90deg,#BE185D 0%,#EC4899 60%,#FB7185 100%)"
              : "linear-gradient(90deg,#0E7490 0%,#22D3EE 100%)",
          }}
          initial={reduce ? { width: `${value}%` } : { width: 0 }}
          whileInView={reduce ? undefined : { width: `${value}%` }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{
            duration: 1.4,
            delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Architecture Layer — used in the stack-compare visual              */
/* ------------------------------------------------------------------ */

function Layer({
  name,
  tone,
  delay = 0,
  highlight = false,
  fromRight = false,
}: {
  name: string;
  tone: "muted" | "primary";
  delay?: number;
  highlight?: boolean;
  fromRight?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={
        reduce ? false : { opacity: 0, x: fromRight ? 16 : -16, filter: "blur(4px)" }
      }
      whileInView={
        reduce ? undefined : { opacity: 1, x: 0, filter: "blur(0px)" }
      }
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={
        tone === "primary"
          ? `relative flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm backdrop-blur-md ${
              highlight
                ? "border-[#BE185D]/40 bg-gradient-to-r from-[#BE185D]/12 via-[#EC4899]/8 to-[#22D3EE]/8 text-[#18181B]"
                : "border-white/70 bg-white/85 text-[#18181B]"
            }`
          : "flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm font-medium text-slate-500"
      }
    >
      {highlight ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-[#BE185D]/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#BE185D]" />
        </span>
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            tone === "primary" ? "bg-[#0E7490]/60" : "bg-slate-300"
          }`}
        />
      )}
      <span className="flex-1">{name}</span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Duel Metric — dueling gauges (standard vs Tamara)                  */
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
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-md"
    >
      {/* Glow tagged top-right */}
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#BE185D] to-[#EC4899] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow">
        {callout}
      </span>

      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>

      {/* Standard row */}
      <div className="mt-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {standardLabel}
          </span>
          <span className="text-xs font-semibold text-slate-400 line-through decoration-slate-300/80">
            {leftDisplay}
          </span>
        </div>
        <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-slate-300"
            initial={reduce ? { width: `${leftPct}%` } : { width: 0 }}
            whileInView={reduce ? undefined : { width: `${leftPct}%` }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1.0, delay: delay + 0.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      {/* Tamara row */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#BE185D]">
            {tamaraLabel}
          </span>
          <span className="font-display text-lg font-bold tabular-nums text-[#BE185D]">
            <CountUp
              value={rightValue}
              decimals={rightDecimals}
              suffix={unit}
              duration={1.4}
            />
          </span>
        </div>
        <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background:
                "linear-gradient(90deg,#BE185D 0%,#EC4899 60%,#FB7185 100%)",
              boxShadow: "0 0 12px rgba(190,24,93,0.45)",
            }}
            initial={reduce ? { width: `${rightPct}%` } : { width: 0 }}
            whileInView={reduce ? undefined : { width: `${rightPct}%` }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1.4, delay: delay + 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny icons                                                         */
/* ------------------------------------------------------------------ */

const IconBolt = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
);

const IconShield = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const IconGlobe = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Environment chip — for noise reduction pillar                     */
/* ------------------------------------------------------------------ */

function EnvChip({
  title,
  desc,
  tone,
  delay = 0,
}: {
  title: string;
  desc: string;
  tone: "cyan" | "magenta" | "coral";
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const ring =
    tone === "magenta"
      ? "ring-[#BE185D]/15"
      : tone === "coral"
        ? "ring-[#FB7185]/20"
        : "ring-[#22D3EE]/20";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`flex flex-col gap-3 rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm ring-1 ${ring} backdrop-blur-md`}
    >
      <Waveform tone={tone} />
      <div>
        <p className="text-sm font-bold text-[#18181B]">{title}</p>
        <p className="mt-1 text-xs leading-snug text-[#475569]">{desc}</p>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pillar wrapper — glass card with header                           */
/* ------------------------------------------------------------------ */

function Pillar({
  index,
  eyebrowIcon,
  eyebrowColor,
  title,
  subtitle,
  children,
}: {
  index: number;
  eyebrowIcon: React.ReactNode;
  eyebrowColor: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 32 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: 0.75,
        delay: index * 0.1,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="relative overflow-hidden rounded-3xl border border-white/40 bg-white/70 p-6 shadow-xl shadow-slate-900/[0.04] backdrop-blur-xl sm:p-8"
    >
      <header className="flex flex-col gap-3">
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            backgroundColor: `${eyebrowColor}14`,
            color: eyebrowColor,
          }}
        >
          {eyebrowIcon}
        </span>
        <h3 className="font-display text-2xl tracking-tight text-[#18181B] sm:text-3xl">
          {title}
        </h3>
        <p className="max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-base">
          {subtitle}
        </p>
      </header>
      <div className="mt-6">{children}</div>
    </motion.article>
  );
}

/* ================================================================== */
/*  Public component                                                   */
/* ================================================================== */

export function PerformanceShowcase() {
  const reduce = useReducedMotion();
  const t = useTranslations("Performance");

  return (
    <section
      id="performance"
      className="relative overflow-hidden py-24 sm:py-32"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-24 -z-10 h-80 w-80 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.25) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-8rem] top-1/3 -z-10 h-96 w-96 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(190,24,93,0.18) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-72 w-72 rounded-full opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(251,113,133,0.18) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* Header */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0E7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181B] sm:text-5xl lg:text-6xl">
            {t("title")}{" "}
            <span className="bg-gradient-to-r from-[#BE185D] via-[#DB2777] to-[#FB7185] bg-clip-text text-transparent">
              {t("titleHighlight")}
            </span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Pillars */}
        <div className="mt-16 flex flex-col gap-6 sm:gap-8">
          {/* ---------------- Pillar 1 — Hyper-evolved model ---------------- */}
          <Pillar
            index={0}
            eyebrowIcon={IconBolt}
            eyebrowColor="#BE185D"
            title={t("pillar1.title")}
            subtitle={t("pillar1.subtitle")}
          >
            {/* ── Architecture stacks side-by-side ─────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto_1.15fr] lg:items-stretch lg:gap-8">
              {/* Standard stack */}
              <div className="relative flex flex-col">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    {t("pillar1.standardName")}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("pillar1.standardLayersBadge")}
                  </span>
                </div>
                <div className="flex flex-1 flex-col justify-between gap-2">
                  <div className="flex flex-col gap-2">
                    <Layer name={t("pillar1.layers.audioStd")} tone="muted" delay={0.0} />
                    <Layer name={t("pillar1.layers.llmGeneric")} tone="muted" delay={0.08} />
                  </div>
                  <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[11px] leading-snug text-slate-500">
                    {t("pillar1.standardFootnote")}
                  </p>
                </div>
              </div>

              {/* VS divider (desktop only) */}
              <div className="hidden flex-col items-center justify-center gap-3 lg:flex">
                <span className="font-display text-2xl font-bold text-slate-300">
                  {t("pillar1.vs")}
                </span>
                <span
                  aria-hidden
                  className="h-32 w-px bg-gradient-to-b from-transparent via-slate-300/60 to-transparent"
                />
              </div>

              {/* Tamara stack */}
              <div className="relative flex flex-col">
                {/* Halo derrière la pile Tamara */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 -z-10 rounded-3xl bg-gradient-to-br from-[#BE185D]/14 via-[#EC4899]/10 to-[#22D3EE]/14 blur-2xl"
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#BE185D]">
                      Tamara Voice Engine
                    </span>
                    <span className="rounded-full bg-gradient-to-r from-[#BE185D] to-[#EC4899] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow-md shadow-[#BE185D]/30">
                      {t("pillar1.hyperBadge")}
                    </span>
                  </span>
                  <span className="rounded-full bg-[#BE185D]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#BE185D]">
                    {t("pillar1.tamaraLayersBadge")}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <Layer name={t("pillar1.layers.audioTamara")} tone="primary" delay={0.0} fromRight />
                  <Layer name={t("pillar1.layers.krisp")} tone="primary" delay={0.06} fromRight />
                  <Layer name={t("pillar1.layers.nearField")} tone="primary" delay={0.12} fromRight />
                  <Layer name={t("pillar1.layers.asr")} tone="primary" delay={0.18} fromRight />
                  <Layer name={t("pillar1.layers.llmTamara")} tone="primary" delay={0.24} fromRight highlight />
                  <Layer name={t("pillar1.layers.nlu")} tone="primary" delay={0.30} fromRight />
                  <Layer name={t("pillar1.layers.tts")} tone="primary" delay={0.36} fromRight />
                </div>
              </div>
            </div>

            {/* ── Dueling metric cards ────────────────────────────────────── */}
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              <DuelMetric
                label={t("pillar1.metrics.latency.label")}
                leftDisplay="~800 ms"
                rightValue={280}
                unit=" ms"
                leftPct={35}
                rightPct={92}
                callout="3× +"
                delay={0.0}
                standardLabel={t("pillar1.metrics.standardLabel")}
                tamaraLabel={t("pillar1.metrics.tamaraLabel")}
              />
              <DuelMetric
                label={t("pillar1.metrics.accuracy.label")}
                leftDisplay="87 %"
                rightValue={98.4}
                rightDecimals={1}
                unit=" %"
                leftPct={87}
                rightPct={98.4}
                callout="+11 pts"
                delay={0.08}
                standardLabel={t("pillar1.metrics.standardLabel")}
                tamaraLabel={t("pillar1.metrics.tamaraLabel")}
              />
              <DuelMetric
                label={t("pillar1.metrics.interruption.label")}
                leftDisplay="~700 ms"
                rightValue={90}
                unit=" ms"
                leftPct={30}
                rightPct={95}
                callout="7× +"
                delay={0.16}
                standardLabel={t("pillar1.metrics.standardLabel")}
                tamaraLabel={t("pillar1.metrics.tamaraLabel")}
              />
              <DuelMetric
                label={t("pillar1.metrics.languages.label")}
                leftDisplay="8"
                rightValue={12}
                unit="+"
                leftPct={50}
                rightPct={100}
                callout="+50 %"
                delay={0.24}
                standardLabel={t("pillar1.metrics.standardLabel")}
                tamaraLabel={t("pillar1.metrics.tamaraLabel")}
              />
            </div>

            <p className="mt-5 text-[11px] italic text-[#94A3B8]">
              {t("pillar1.metricsFootnote")}
            </p>
          </Pillar>

          {/* -------------- Pillar 2 — Noise reduction -------------- */}
          <Pillar
            index={1}
            eyebrowIcon={IconShield}
            eyebrowColor="#0E7490"
            title={t("pillar2.title")}
            subtitle={t("pillar2.subtitle")}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <EnvChip
                tone="cyan"
                delay={0.0}
                title={t("pillar2.envs.cafe.title")}
                desc={t("pillar2.envs.cafe.desc")}
              />
              <EnvChip
                tone="magenta"
                delay={0.08}
                title={t("pillar2.envs.car.title")}
                desc={t("pillar2.envs.car.desc")}
              />
              <EnvChip
                tone="coral"
                delay={0.16}
                title={t("pillar2.envs.openSpace.title")}
                desc={t("pillar2.envs.openSpace.desc")}
              />
            </div>
          </Pillar>

          {/* --------------- Pillar 3 — Multilingual accuracy --------------- */}
          <Pillar
            index={2}
            eyebrowIcon={IconGlobe}
            eyebrowColor="#BE185D"
            title={t("pillar3.title")}
            subtitle={t("pillar3.subtitle")}
          >
            <div className="flex flex-col gap-5">
              <AccuracyBar
                label={t("pillar3.langs.fr")}
                value={98.7}
                delay={0.0}
              />
              <AccuracyBar
                label={t("pillar3.langs.he")}
                value={98.4}
                highlight
                delay={0.15}
                isRTL
                highlightBadge={t("pillar3.unprecedentedBadge")}
              />
              <AccuracyBar
                label={t("pillar3.langs.en")}
                value={99.1}
                delay={0.3}
              />
            </div>
            <p className="mt-6 text-[11px] italic text-[#94A3B8]">
              {t("pillar3.footnote")}
            </p>
          </Pillar>
        </div>
      </div>
    </section>
  );
}
