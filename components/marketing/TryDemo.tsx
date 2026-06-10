"use client";

import { useTranslations } from "next-intl";

import VoiceAgent from "@/components/VoiceAgent";

import { Reveal } from "./Reveal";

/**
 * TryDemo — section dédiée à la démo interactive WebRTC, extraite du Hero.
 * Glass card éditoriale qui héberge le VoiceAgent, posée sur un halo
 * conic rose→cyan en rotation lente (CSS pur, coupé en reduced-motion).
 */
export function TryDemo() {
  // Réutilise les keys i18n existantes du namespace Hero pour la démo.
  const t = useTranslations("Hero");

  return (
    <section id="demo" className="relative py-24 sm:py-32">
      {/* Décoration : 2 blobs subtils */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 end-0 h-96 w-96 rounded-full bg-gradient-to-br from-[#22d3ee]/15 to-transparent blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 start-0 h-80 w-80 rounded-full bg-gradient-to-br from-[#fb7185]/15 to-transparent blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("demo.title")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("demo.subtitle")}
          </h2>
        </Reveal>

        <Reveal y={32} className="relative mt-12">
          {/* Halo gradient animé derrière la carte : conic rose→cyan qui
           *  tourne lentement, flouté. Transform-only, aria-hidden, coupé
           *  via media query en reduced-motion. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 overflow-hidden rounded-[2.5rem] opacity-60"
          >
            <div
              className="demo-halo absolute top-1/2 left-1/2 aspect-square w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(236,72,153,0.30), rgba(34,211,238,0.22), rgba(251,113,133,0.26), rgba(236,72,153,0.30))",
              }}
            />
          </div>

          <VoiceAgent />
        </Reveal>
      </div>

      <style jsx>{`
        .demo-halo {
          animation: demo-halo-spin 28s linear infinite;
        }
        @keyframes demo-halo-spin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .demo-halo {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
