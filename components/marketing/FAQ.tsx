"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EASE, Reveal, Stagger, StaggerItem } from "./Reveal";

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const;
type FaqKey = (typeof FAQ_KEYS)[number];

export function FAQ() {
  const t = useTranslations("FAQ");
  const reduce = useReducedMotion();
  const [openKey, setOpenKey] = useState<FaqKey | null>(null);

  return (
    <section
      id="faq"
      className="relative overflow-hidden bg-gradient-to-b from-[#faf7f2] via-white to-[#faf7f2] py-24 sm:py-32"
    >
      {/* Subtle radial accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 12% 10%, rgba(190,24,93,0.06) 0%, transparent 70%), radial-gradient(45% 40% at 88% 90%, rgba(34,211,238,0.07) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto w-full max-w-5xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#be185d] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("subtitle")}
          </p>
        </Reveal>

        <Stagger className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
          {FAQ_KEYS.map((key) => {
            const isOpen = openKey === key;
            return (
              <StaggerItem key={key}>
                <div
                  className={`group relative overflow-hidden rounded-2xl border bg-white/60 shadow-md backdrop-blur transition-colors ${
                    isOpen
                      ? "border-[#22d3ee]/50"
                      : "border-white/40 hover:border-[#22d3ee]/40"
                  }`}
                >
                  {/* Accent gradient côté début quand ouvert */}
                  <motion.span
                    aria-hidden
                    initial={false}
                    animate={{ opacity: isOpen ? 1 : 0 }}
                    transition={{ duration: 0.25 }}
                    className="absolute start-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#be185d] to-[#22d3ee]"
                  />

                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : key)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${key}`}
                    className="flex w-full cursor-pointer items-start justify-between gap-4 px-6 py-5 text-start"
                  >
                    <span className="text-base font-extrabold leading-snug text-[#18181b] sm:text-lg">
                      {t(`${key}.question`)}
                    </span>
                    <motion.span
                      aria-hidden
                      initial={false}
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
                      className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isOpen
                          ? "border-[#22d3ee]/50 bg-gradient-to-br from-[#fce7f3] to-[#cffafe] text-[#be185d]"
                          : "border-slate-200 bg-white text-slate-500 group-hover:text-[#be185d]"
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className="h-4 w-4"
                        aria-hidden
                      >
                        <path
                          d="m6 9 6 6 6-6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </motion.span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        id={`faq-panel-${key}`}
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: { duration: reduce ? 0 : 0.35, ease: EASE },
                          opacity: { duration: reduce ? 0 : 0.25, ease: "easeOut" },
                        }}
                        className="overflow-hidden"
                      >
                        <div className="px-6 pb-5 pt-0">
                          <p className="text-sm leading-relaxed text-[#475569]">
                            {t(`${key}.answer`)}
                          </p>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}
