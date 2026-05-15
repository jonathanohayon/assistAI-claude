"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

import VoiceAgent from "@/components/VoiceAgent";

/**
 * TryDemo — section dédiée à la démo interactive WebRTC, extraite du Hero.
 * Glass card éditoriale qui héberge le VoiceAgent.
 */
export function TryDemo() {
  // Réutilise les keys i18n existantes du namespace Hero pour la démo.
  const t = useTranslations("Hero");

  return (
    <section id="demo" className="relative py-24 sm:py-32">
      {/* Décoration : 2 blobs subtils */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 right-0 h-96 w-96 rounded-full bg-gradient-to-br from-[#22d3ee]/15 to-transparent blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 left-0 h-80 w-80 rounded-full bg-gradient-to-br from-[#fb7185]/15 to-transparent blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("demo.title")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("demo.subtitle")}
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mt-12"
        >
          <VoiceAgent />
        </motion.div>
      </div>
    </section>
  );
}
