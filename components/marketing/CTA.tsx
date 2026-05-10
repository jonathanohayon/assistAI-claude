"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function CTA() {
  const t = useTranslations("CTA");
  return (
    <section className="relative px-6 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[2.5rem] border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-foreground)] via-[#6b1839] to-[#5b1233] p-10 sm:p-16"
        >
          {/* Floating orbs */}
          <motion.div
            aria-hidden
            animate={{ x: [0, 40, 0], y: [0, -20, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            className="pointer-events-none absolute -right-10 -top-10 h-72 w-72 rounded-full bg-gradient-to-br from-[#f9a8d4]/40 to-[#c4b5fd]/30 blur-3xl"
          />
          <motion.div
            aria-hidden
            animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 3 }}
            className="pointer-events-none absolute -bottom-10 -left-10 h-80 w-80 rounded-full bg-gradient-to-br from-[#ec4899]/30 to-[#8b5cf6]/30 blur-3xl"
          />

          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-pink-200">
              {t("kicker")}
            </p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight text-white sm:text-5xl">
              {t("title")}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-pink-100/80">
              {t("subtitle")}
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-white px-6 py-3 text-sm font-medium text-[var(--color-foreground)] shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-pink-200/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative">{t("ctaPrimary")}</span>
                <svg viewBox="0 0 24 24" fill="none" className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5">
                  <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                {t("ctaSecondary")}
              </a>
            </div>

            <p className="mt-8 text-xs text-pink-200/60">
              {t("footer")}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
