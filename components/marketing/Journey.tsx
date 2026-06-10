"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";
import { EASE, Reveal, Stagger, StaggerItem } from "./Reveal";

/**
 * Journey — section scroll-storytelling unique qui fusionne l'ancienne
 * timeline d'onboarding (TwoMinutesToLive) et le process (HowItWorks).
 *
 * Desktop : les 4 étapes longent une ligne de progression verticale qui se
 * dessine au scroll (rose → cyan) ; chaque étape s'allume quand la ligne
 * l'atteint. En colonne end, le phone mockup reste sticky : « pendant que tu
 * fais ça, elle répond déjà ».
 * Mobile : timeline verticale simple + phone après les étapes.
 */

type StepKey = "signup" | "number" | "agent" | "live";

type Step = {
  key: StepKey;
  time: string;
  icon: ReactNode;
  live?: boolean;
};

const STEPS: Step[] = [
  {
    key: "signup",
    time: "00:30",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    ),
  },
  {
    key: "number",
    time: "01:00",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
  },
  {
    key: "agent",
    time: "01:30",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <path d="M12 18v4M8 22h8" />
      </svg>
    ),
  },
  {
    key: "live",
    time: "02:00",
    live: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M2 12a10 10 0 0 1 20 0M6 12a6 6 0 0 1 12 0M10 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" />
      </svg>
    ),
  },
];

function LiveBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/30">
      <span aria-hidden className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}

/**
 * Une étape de la timeline. S'allume (icône qui passe en couleur via un
 * crossfade d'opacité, badge temps qui scale) quand la ligne de progression
 * atteint son seuil sur le scroll.
 */
function JourneyStep({
  step,
  index,
  total,
  progress,
}: {
  step: Step;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const t = useTranslations("TwoMinutes");
  const reduce = useReducedMotion();

  // Seuil d'activation : réparti le long de la ligne, légèrement en avance
  // sur le centre de l'étape pour que l'allumage paraisse « atteint ».
  const at = (index + 0.35) / total;
  const litOpacity = useTransform(progress, [at - 0.1, at], [0, 1]);
  const badgeScale = useTransform(progress, [at - 0.1, at], [0.75, 1]);

  return (
    <li>
      <StaggerItem className="relative ps-24 sm:ps-28">
        {/* Pastille icône sur la ligne */}
        <div className="absolute start-0 top-0">
          <div className="relative inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/60 bg-white/80 text-[#64748b] shadow-[0_8px_32px_-12px_rgba(190,24,93,0.18)] backdrop-blur-xl">
            {step.icon}
            {/* Calque « allumé » — crossfade piloté par le scroll */}
            <motion.span
              aria-hidden
              style={reduce ? undefined : { opacity: litOpacity }}
              className="absolute inset-0 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-[#be185d] via-[#db2777] to-[#0e7490] text-white"
            >
              {step.icon}
            </motion.span>
            {step.live && (
              <span aria-hidden className="absolute -end-1 -top-1 inline-flex h-3.5 w-3.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
              </span>
            )}
          </div>
        </div>

        {/* Carte */}
        <div className="rounded-[1.75rem] border border-white/40 bg-white/70 p-6 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.12)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-2">
            <motion.span
              style={reduce ? undefined : { scale: badgeScale }}
              className="inline-flex items-center rounded-full bg-gradient-to-r from-[#be185d] to-[#db2777] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white"
            >
              {step.time}
            </motion.span>
            {step.live && <LiveBadge label={t("liveBadge")} />}
          </div>
          <h3 className="mt-3 font-display text-xl text-[#18181b]">
            {t(`steps.${step.key}.title`)}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#475569]">
            {t(`steps.${step.key}.sub`)}
          </p>
        </div>
      </StaggerItem>
    </li>
  );
}

/** Phone mockup — l'agent répond déjà pendant l'onboarding (climax sticky). */
function PhoneMockup() {
  const t = useTranslations("TwoMinutes");
  const reduce = useReducedMotion();

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 p-6 shadow-[0_20px_60px_-20px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-8">
      {/* Liseré gradient en haut */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#22d3ee] via-[#db2777] to-[#fb7185]"
      />

      {/* En-tête téléphone */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ecfeff] to-[#fdf2f8] text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/30">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </span>
          <div>
            <p
              dir="ltr"
              className="font-mono text-sm font-semibold tabular-nums text-[#18181b]"
            >
              +33 6 12 34 56 78
            </p>
            <p className="text-xs text-[#475569]">{t("phone.incoming")}</p>
          </div>
        </div>
        <LiveBadge label={t("liveBadge")} />
      </div>

      {/* Appelante */}
      <div className="mt-6 flex items-center gap-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#fb7185] to-[#db2777] font-display text-lg font-semibold text-white">
          SC
        </div>
        <div>
          <p className="font-display text-lg text-[#18181b]">
            {t("phone.callerName")}
          </p>
          <p className="flex items-center gap-2 text-sm text-[#475569]">
            <span aria-hidden className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22d3ee] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22d3ee]" />
            </span>
            {t("phone.status")}
          </p>
        </div>
      </div>

      {/* Bulle de transcription */}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={
          reduce ? { duration: 0.2 } : { duration: 0.6, delay: 0.4, ease: EASE }
        }
        className="mt-6 rounded-2xl rounded-ss-sm bg-gradient-to-br from-[#fdf2f8] to-[#ecfeff] p-4 ring-1 ring-inset ring-[#be185d]/10"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-[#be185d]">
          {t("phone.transcriptLabel")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#18181b]">
          {t("phone.transcriptText")}
        </p>
      </motion.div>
    </div>
  );
}

export function Journey() {
  const t = useTranslations("TwoMinutes");
  const reduce = useReducedMotion();

  const stepsRef = useRef<HTMLOListElement>(null);
  // La ligne se dessine quand chaque étape franchit 70% du viewport.
  const { scrollYProgress } = useScroll({
    target: stepsRef,
    offset: ["start 0.7", "end 0.7"],
  });
  const lineProgress = useSpring(scrollYProgress, {
    stiffness: 220,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <section id="how" className="relative py-24 sm:py-32">
      {/* Blobs décoratifs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -start-24 -z-10 h-96 w-96 rounded-full bg-[#22d3ee]/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -end-24 -z-10 h-[28rem] w-[28rem] rounded-full bg-[#be185d]/15 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* Header */}
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("eyebrow")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </Reveal>

        {/* Corps : étapes (start) + phone sticky (end) */}
        <div className="mt-20 grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-16">
          {/* Colonne étapes + ligne de progression */}
          <div className="relative">
            {/* Rail neutre */}
            <div
              aria-hidden
              className="absolute start-10 top-10 bottom-10 w-0.5 rounded-full bg-[#18181b]/10"
            />
            {/* Ligne qui se dessine au scroll (pleine si reduced motion) */}
            {reduce ? (
              <div
                aria-hidden
                className="absolute start-10 top-10 bottom-10 w-0.5 rounded-full bg-gradient-to-b from-[#db2777] via-[#be185d] to-[#22d3ee]"
              />
            ) : (
              <motion.div
                aria-hidden
                style={{ scaleY: lineProgress, transformOrigin: "top" }}
                className="absolute start-10 top-10 bottom-10 w-0.5 rounded-full bg-gradient-to-b from-[#db2777] via-[#be185d] to-[#22d3ee]"
              />
            )}

            <Stagger>
              <ol ref={stepsRef} className="flex flex-col gap-12 lg:gap-16">
                {STEPS.map((s, i) => (
                  <JourneyStep
                    key={s.key}
                    step={s}
                    index={i}
                    total={STEPS.length}
                    progress={lineProgress}
                  />
                ))}
              </ol>
            </Stagger>
          </div>

          {/* Colonne phone — sticky sur desktop, après les étapes sur mobile */}
          <div className="relative">
            <div className="lg:sticky lg:top-24">
              <Reveal delay={0.1}>
                <PhoneMockup />
              </Reveal>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
