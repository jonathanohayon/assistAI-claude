"use client";

import { motion } from "motion/react";
import { useReducedMotionAfterMount } from "@/lib/use-reduced-motion-after-mount";
import { useTranslations } from "next-intl";
import type { SectionHeading } from "@/lib/marketing/home-content";

import { CampaignPanel } from "./CampaignPanel";
import { COMMAND_CENTRE_BG, CommandCentreGlows } from "./CommandCentre";
import { Reveal, Stagger, StaggerItem } from "./Reveal";

// Section marketing « Appels sortants » — vaisseau amiral de la landing.
// Seule section sombre de la page : un « command center » où des agents IA
// composent en parallèle. Garde le cycling de statuts + ripple de la version
// précédente, amplifié par un compteur de lignes actives et des mini
// waveforms sur les appels connectés.

const USE_CASES = [
  {
    key: "sales",
    accent: "from-[#be185d] to-[#ec4899]",
    tint: "text-[#f472b6]",
    icon: <path d="M3 3v18h18M19 9l-5 5-4-4-4 4" />,
  },
  {
    key: "lead",
    accent: "from-[#0e7490] to-[#22d3ee]",
    tint: "text-[#22d3ee]",
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
      </>
    ),
  },
  {
    key: "marketing",
    accent: "from-[#db2777] to-[#f472b6]",
    tint: "text-[#f9a8d4]",
    icon: (
      <path d="M3 11v3a1 1 0 0 0 1 1h3l4 4V7L7 11H4a1 1 0 0 0-1 0ZM16 8a5 5 0 0 1 0 8M19.5 5a9 9 0 0 1 0 14" />
    ),
  },
] as const;

export function OutboundCalling({
  copy,
}: {
  /** A landing page's heading. With it, the section is the live campaign
   *  panel alone (the page carries its own use cases). */
  copy?: SectionHeading;
} = {}) {
  const t = useTranslations("OutboundCalling");
  const reduce = useReducedMotionAfterMount() ?? false;

  return (
    <section
      id="outbound"
      className={`relative overflow-hidden ${COMMAND_CENTRE_BG} py-24 sm:py-32`}
    >
      <CommandCentreGlows />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* En-tête */}
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#22d3ee]/30 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#22d3ee] backdrop-blur">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse"
            />
            {copy ? copy.kicker : t("kicker")}
          </span>
          <h2 className="mt-4 font-display text-4xl tracking-tight text-white sm:text-5xl lg:text-6xl">
            {copy ? copy.title : t("title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70 sm:text-lg">
            {copy ? copy.subtitle : t("subtitle")}
          </p>
        </Reveal>

        <div className={copy ? "mx-auto mt-14 max-w-3xl" : "mt-14 grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start lg:gap-8"}>
          {/* Cas d'usage — cartes glassy sombres */}
          {copy ? null : (
          <Stagger className="flex flex-col gap-4 lg:col-span-2">
            {USE_CASES.map((u) => (
              <StaggerItem key={u.key}>
                <motion.div
                  whileHover={reduce ? undefined : { y: -4 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  className="group flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition-colors duration-300 hover:border-[#22d3ee]/50 hover:bg-white/[0.07]"
                >
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${u.accent} text-white shadow-md ring-1 ring-white/20 transition-transform group-hover:rotate-3 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:scale-100`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      {u.icon}
                    </svg>
                  </span>
                  <div className="min-w-0 text-start">
                    <h3 className={`font-display text-lg tracking-tight ${u.tint}`}>
                      {t(`use_${u.key}_title`)}
                    </h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/70">
                      {t(`use_${u.key}_desc`)}
                    </p>
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
          )}

          {/* Carte « campagne en direct » : la liste de numéros appelés */}
          <CampaignPanel className={copy ? "" : "lg:col-span-3"} />
        </div>
      </div>
    </section>
  );
}

