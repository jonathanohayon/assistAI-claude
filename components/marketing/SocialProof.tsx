"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

export function SocialProof() {
  const t = useTranslations("SocialProof");
  const QUOTES = [
    { text: t("q1.text"), author: t("q1.author"), role: t("q1.role") },
    { text: t("q2.text"), author: t("q2.author"), role: t("q2.role") },
    { text: t("q3.text"), author: t("q3.author"), role: t("q3.role") },
  ];

  return (
    <section className="relative bg-gradient-to-b from-[#fdf2f8] to-white py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="max-w-2xl"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {QUOTES.map((q, i) => (
            <motion.figure
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="relative rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm"
            >
              <svg
                viewBox="0 0 32 24"
                fill="none"
                className="absolute right-5 top-5 h-7 w-7 text-[var(--color-primary)]/20"
              >
                <path d="M0 24V12C0 5.4 4.5 1 12 0v6c-3 1-4.5 3-4.5 6H12v12H0Zm20 0V12C20 5.4 24.5 1 32 0v6c-3 1-4.5 3-4.5 6H32v12H20Z" fill="currentColor" />
              </svg>
              <blockquote className="font-display text-base leading-relaxed text-[var(--color-foreground)]">
                {q.text}
              </blockquote>
              <figcaption className="mt-5 border-t border-[var(--color-border)]/60 pt-4">
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {q.author}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {q.role}
                </p>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
