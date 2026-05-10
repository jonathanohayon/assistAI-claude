"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  const STEPS = [
    { n: "01", key: "step1" as const },
    { n: "02", key: "step2" as const },
    { n: "03", key: "step3" as const },
    { n: "04", key: "step4" as const },
  ];

  return (
    <section id="how" className="relative bg-gradient-to-b from-white to-[#fdf2f8] py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="relative mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Connecting line on lg+ */}
          <motion.div
            aria-hidden
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, delay: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: "left" }}
            className="absolute left-0 right-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/40 to-transparent lg:block"
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
              className="relative flex flex-col items-start"
            >
              <div className="relative z-10 mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-[var(--color-border)]">
                <span className="font-display text-base text-[var(--color-primary)]">
                  {s.n}
                </span>
              </div>
              <h3 className="font-display text-lg text-[var(--color-foreground)]">
                {t(`${s.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t(`${s.key}.desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
