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
          className="relative overflow-hidden rounded-[2.5rem] border border-white/40 p-10 shadow-[0_24px_80px_-24px_rgba(190,24,93,0.30)] backdrop-blur-xl sm:p-16"
          style={{
            // Mesh aurora marque (rose magenta + cyan voice tech) sur fond
            // cream warm. Remplace l'ancien bloc bordeaux/aubergine pour
            // s'aligner sur le DNA Voice Studio dashboard.
            backgroundColor: "#FAF7F2",
            backgroundImage: `
              radial-gradient(at 12% 20%, rgba(236, 72, 153, 0.30) 0px, transparent 50%),
              radial-gradient(at 85% 15%, rgba(34, 211, 238, 0.28) 0px, transparent 55%),
              radial-gradient(at 50% 90%, rgba(190, 24, 93, 0.22) 0px, transparent 60%),
              radial-gradient(at 90% 75%, rgba(34, 211, 238, 0.20) 0px, transparent 50%)
            `,
          }}
        >
          {/* Floating glow orbs — marque cyan + magenta */}
          <motion.div
            aria-hidden
            animate={{ x: [0, 40, 0], y: [0, -20, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            className="pointer-events-none absolute -right-10 -top-10 h-72 w-72 rounded-full bg-gradient-to-br from-[#22d3ee]/40 to-[#22d3ee]/15 blur-3xl"
          />
          <motion.div
            aria-hidden
            animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
            transition={{
              duration: 18,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 3,
            }}
            className="pointer-events-none absolute -bottom-10 -left-10 h-80 w-80 rounded-full bg-gradient-to-br from-[#ec4899]/30 to-[#fb7185]/20 blur-3xl"
          />

          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
              {t("kicker")}
            </p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
              {t("title")}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#475569]">
              {t("subtitle")}
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_28px_-8px_rgba(190,24,93,0.5)] ring-2 ring-[#22d3ee]/30 transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative">{t("ctaPrimary")}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5"
                >
                  <path
                    d="M5 12h14M13 5l7 7-7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-[#18181b]/15 bg-white/60 px-6 py-3 text-sm font-semibold text-[#18181b] backdrop-blur transition-all hover:border-[#0e7490]/40 hover:bg-white"
              >
                {t("ctaSecondary")}
              </a>
            </div>

            <p className="mt-8 text-xs text-[#475569]">{t("footer")}</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
