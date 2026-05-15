"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

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

const EASE = [0.16, 1, 0.3, 1] as const;

export function TwoMinutesToLive() {
  const prefersReducedMotion = useReducedMotion();
  const t = useTranslations("TwoMinutes");

  const baseTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.7, ease: EASE };

  return (
    <section id="two-minutes" className="relative py-24 sm:py-32">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 -z-10 h-96 w-96 rounded-full bg-[#22d3ee]/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-24 -z-10 h-[28rem] w-[28rem] rounded-full bg-[#be185d]/15 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={baseTransition}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("eyebrow")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Timeline */}
        <div className="relative mt-20">
          {/* Horizontal connecting line (desktop) */}
          <motion.div
            aria-hidden
            initial={{ scaleX: prefersReducedMotion ? 1 : 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 1.4, delay: 0.3, ease: EASE }
            }
            style={{ transformOrigin: "left" }}
            className="absolute left-12 right-12 top-10 hidden h-0.5 bg-gradient-to-r from-[#22d3ee] via-[#db2777] to-[#fb7185] lg:block"
          />

          {/* Vertical connecting line (mobile) */}
          <motion.div
            aria-hidden
            initial={{ scaleY: prefersReducedMotion ? 1 : 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 1.4, delay: 0.3, ease: EASE }
            }
            style={{ transformOrigin: "top" }}
            className="absolute left-10 top-12 bottom-12 w-0.5 bg-gradient-to-b from-[#22d3ee] via-[#db2777] to-[#fb7185] lg:hidden"
          />

          <ol className="relative grid grid-cols-1 gap-8 lg:grid-cols-4 lg:gap-6">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.time}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 0.7, delay: i * 0.12, ease: EASE }
                }
                className="relative pl-20 lg:pl-0"
              >
                {/* Step badge — circle on the timeline */}
                <div className="absolute left-0 top-0 lg:relative lg:left-auto lg:top-auto lg:mb-6 lg:flex lg:justify-center">
                  <div className="relative inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/60 bg-white/80 text-[#0e7490] shadow-[0_8px_32px_-12px_rgba(190,24,93,0.18)] backdrop-blur-xl">
                    {s.icon}
                    {s.live && (
                      <span className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Card */}
                <div className="rounded-[1.75rem] border border-white/40 bg-white/70 p-6 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.12)] backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-gradient-to-r from-[#be185d] to-[#db2777] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white">
                      {s.time}
                    </span>
                    {s.live && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/30">
                        <span className="relative inline-flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        {t("liveBadge")}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 font-display text-xl text-[#18181b]">
                    {t(`steps.${s.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#475569]">
                    {t(`steps.${s.key}.sub`)}
                  </p>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* Incoming call mockup */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 0.8, delay: 0.2, ease: EASE }
          }
          className="mx-auto mt-20 max-w-xl"
        >
          <div className="relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 p-6 shadow-[0_20px_60px_-20px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-8">
            {/* Top gradient accent */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#22d3ee] via-[#db2777] to-[#fb7185]"
            />

            {/* Phone header */}
            <div className="flex items-center justify-between">
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
                  <p className="font-mono text-sm font-semibold tabular-nums text-[#18181b]">
                    +33 6 12 34 56 78
                  </p>
                  <p className="text-xs text-[#475569]">{t("phone.incoming")}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/30">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {t("liveBadge")}
              </span>
            </div>

            {/* Caller */}
            <div className="mt-6 flex items-center gap-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#fb7185] to-[#db2777] font-display text-lg font-semibold text-white">
                SC
              </div>
              <div>
                <p className="font-display text-lg text-[#18181b]">
                  {t("phone.callerName")}
                </p>
                <p className="flex items-center gap-2 text-sm text-[#475569]">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22d3ee] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22d3ee]" />
                  </span>
                  {t("phone.status")}
                </p>
              </div>
            </div>

            {/* Transcript bubble */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: 0.6, delay: 0.5, ease: EASE }
              }
              className="mt-6 rounded-2xl rounded-tl-sm bg-gradient-to-br from-[#fdf2f8] to-[#ecfeff] p-4 ring-1 ring-inset ring-[#be185d]/10"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-[#be185d]">
                {t("phone.transcriptLabel")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#18181b]">
                {t("phone.transcriptText")}
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
