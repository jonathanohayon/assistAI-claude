"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

type BadgeKey = "rgpd" | "hds" | "e2e" | "audit" | "eu" | "soc2";

const ICONS: Record<BadgeKey, ReactNode> = {
  rgpd: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <path
        d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  hds: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 8v8M8 12h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  e2e: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <rect
        x="4"
        y="10"
        width="16"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 10V7a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <path
        d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M8 13h8M8 17h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  eu: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  soc2: (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <path
        d="M12 2 4 5v7c0 4 3.4 7.6 8 10 4.6-2.4 8-6 8-10V5l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const BADGE_KEYS: BadgeKey[] = ["rgpd", "hds", "e2e", "audit", "eu", "soc2"];

export function Security() {
  const t = useTranslations("Security");
  const reduce = useReducedMotion();

  return (
    <section
      id="security"
      className="relative overflow-hidden bg-[#faf7f2] py-16 sm:py-20"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 0%, rgba(34,211,238,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-start gap-3 sm:max-w-2xl"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="font-display text-2xl tracking-tight text-[#be185d] sm:text-3xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {BADGE_KEYS.map((key, i) => (
            <motion.div
              key={key}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.06,
                ease: "easeOut",
              }}
              whileHover={
                reduce
                  ? undefined
                  : { scale: 1.03, transition: { duration: 0.2 } }
              }
              className="group relative flex flex-col items-center rounded-xl border border-white/40 bg-white/50 p-4 text-center shadow-sm backdrop-blur transition-shadow hover:shadow-md hover:ring-2 hover:ring-[#22d3ee]/30"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center text-[#0e7490] transition-transform group-hover:scale-110">
                {ICONS[key]}
              </span>
              <h3 className="mt-3 text-xs font-bold uppercase tracking-wider text-[#18181b]">
                {t(`badges.${key}.title`)}
              </h3>
              <p className="mt-1 text-[10px] leading-snug text-[#475569]">
                {t(`badges.${key}.desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @media (prefers-reduced-motion: reduce) {
          section :global(*) {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </section>
  );
}
