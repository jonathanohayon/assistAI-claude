"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

const STEPS = [
  {
    n: "01",
    key: "step1" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      </svg>
    ),
  },
  {
    n: "02",
    key: "step2" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 9h18M8 3v4M16 3v4" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
  },
  {
    n: "03",
    key: "step3" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
  },
  {
    n: "04",
    key: "step4" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M3 11v2a8 8 0 0 0 16 0v-2" />
        <path d="M11 19v3M8 22h6" />
        <rect x="9" y="3" width="6" height="12" rx="3" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <section id="how" className="relative py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-[#fdf2f8]/40 to-transparent"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="relative mt-20 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {/* Connecting line gradient cyan→magenta — desktop only */}
          <motion.div
            aria-hidden
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.4, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "left" }}
            className="absolute left-12 right-12 top-24 hidden h-0.5 bg-gradient-to-r from-[#22d3ee] via-[#ec4899] to-[#22d3ee] lg:block"
          />

          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.7,
                delay: i * 0.12,
                ease: [0.16, 1, 0.3, 1],
              }}
              whileHover={{ y: -6 }}
              className="group relative flex flex-col items-start rounded-[2rem] border border-white/40 bg-white/65 p-6 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.12)] backdrop-blur-xl transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_16px_40px_-16px_rgba(34,211,238,0.25)] sm:p-7"
            >
              {/* Numéro display géant magenta + icône inset */}
              <div className="relative z-10 mb-4 inline-flex items-end gap-3">
                <span className="font-display text-5xl font-bold leading-none tracking-tight text-[#be185d] sm:text-6xl">
                  {s.n}
                </span>
                <span className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ecfeff] to-[#fdf2f8] text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/30 transition-transform group-hover:rotate-3 group-hover:scale-110">
                  {s.icon}
                </span>
              </div>
              <h3 className="font-display text-xl text-[#18181b]">
                {t(`${s.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#475569]">
                {t(`${s.key}.desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
