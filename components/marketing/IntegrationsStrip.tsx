"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

import { EASE } from "./Reveal";

/**
 * Bande intégrations — pattern « integrations cloud » (21st.dev) :
 * cluster centré, Tamara au milieu (anneaux pulsants + respiration), les
 * 3 outils en orbite qui flottent doucement. Logos OFFICIELS (constructions
 * vectorielles fidèles : cadre multicolore Calendar, fichier vert Sheets).
 */

const TOOLS = [
  { key: "whatsapp", icon: <WhatsAppIcon /> },
  { key: "calendar", icon: <GoogleCalendarIcon /> },
  { key: "crm", icon: <GoogleSheetsIcon /> },
  { key: "gmail", icon: <GmailIcon /> },
] as const;

export function IntegrationsStrip() {
  const t = useTranslations("Integrations");
  const reduce = useReducedMotion();

  const pop = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.75, y: 16 },
    whileInView: reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 },
    viewport: { once: true, margin: "-10%" } as const,
    transition: reduce
      ? { duration: 0.2 }
      : { delay, type: "spring" as const, stiffness: 240, damping: 20 },
  });

  /** Flottement continu des tuiles outils, déphasé pour un effet organique. */
  const float = (delay: number) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -5, 0] },
          transition: {
            duration: 3.8,
            repeat: Infinity,
            ease: "easeInOut" as const,
            delay,
          },
        };

  return (
    <section
      aria-label={t("kicker")}
      className="relative overflow-hidden py-16 sm:py-20"
    >
      {/* Glow radial doux derrière le cluster */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[42%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.16),rgba(219,39,119,0.09),transparent)] blur-2xl"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        {/* Cluster : WhatsApp au-dessus, Calendar · TAMARA · Sheets au centre */}
        <div className="mx-auto flex w-fit flex-col items-center gap-3">
          <motion.div {...pop(0.25)}>
            <motion.div {...float(0.6)}>
              <Tile>{TOOLS[0].icon}</Tile>
            </motion.div>
          </motion.div>

          <div className="flex items-center gap-3">
            <motion.div {...pop(0.35)}>
              <motion.div {...float(1.4)}>
                <Tile>{TOOLS[1].icon}</Tile>
              </motion.div>
            </motion.div>

            {/* Tuile Tamara — anneaux pulsants + respiration lente */}
            <motion.div {...pop(0.1)} className="relative">
              {!reduce && (
                <>
                  <span aria-hidden className="pulse-ring" />
                  <span
                    aria-hidden
                    className="pulse-ring"
                    style={{ animationDelay: "1.4s" }}
                  />
                </>
              )}
              <motion.div
                animate={reduce ? undefined : { scale: [1, 1.045, 1] }}
                transition={
                  reduce
                    ? undefined
                    : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
                }
                // Même signature que le CTA héro : magenta→rose vif saturé +
                // anneau cyan (le mix rose→cyan en dégradé donnait un milieu
                // grisâtre, d'où l'effet « fade »).
                className="relative flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#be185d] via-[#ec4899] to-[#ff4d8d] shadow-[0_18px_44px_-10px_rgba(236,72,153,0.65)] ring-2 ring-[#22d3ee]/50"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-9 w-9 text-white"
                  aria-hidden
                >
                  <path
                    d="M12 3a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Z"
                    fill="currentColor"
                  />
                  <path
                    d="M5 11a7 7 0 0 0 14 0M12 18v3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </motion.div>
            </motion.div>

            <motion.div {...pop(0.45)}>
              <motion.div {...float(2.2)}>
                <Tile>{TOOLS[2].icon}</Tile>
              </motion.div>
            </motion.div>
          </div>

          {/* Gmail en bas — le cluster forme un losange autour de Tamara */}
          <motion.div {...pop(0.55)}>
            <motion.div {...float(3.0)}>
              <Tile>{TOOLS[3].icon}</Tile>
            </motion.div>
          </motion.div>
        </div>

        {/* Texte sous le cluster */}
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ delay: 0.5, duration: 0.6, ease: EASE }}
          className="mx-auto mt-8 max-w-2xl text-center"
        >
          <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[#0e7490]">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
            </span>
            {t("kicker")}
          </p>
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm leading-relaxed text-[#64748b]">
            <span>{t("whatsapp")}</span>
            <span aria-hidden className="text-[#f472b6]">
              ·
            </span>
            <span>{t("calendar")}</span>
            <span aria-hidden className="text-[#f472b6]">
              ·
            </span>
            <span>{t("crm")}</span>
            <span aria-hidden className="text-[#f472b6]">
              ·
            </span>
            <span>{t("gmail")}</span>
          </p>
        </motion.div>
      </div>

      <style jsx>{`
        .pulse-ring {
          position: absolute;
          inset: 0;
          border-radius: 1rem;
          border: 1.5px solid rgba(34, 211, 238, 0.45);
          animation: tile-pulse 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
          pointer-events: none;
        }
        @keyframes tile-pulse {
          0% {
            transform: scale(1);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pulse-ring {
            animation: none;
            display: none;
          }
        }
      `}</style>
    </section>
  );
}

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <div className="group flex size-16 items-center justify-center rounded-2xl border border-[#fbcfe8] bg-white/90 p-3 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-[#22d3ee]/50 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span
        aria-hidden
        className="h-full w-full transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:scale-100"
      >
        {children}
      </span>
    </div>
  );
}

/* ----------------------------- brand icons -------------------------------- */
/* Constructions vectorielles fidèles aux logos officiels — pas d'emoji.      */

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        fill="#25D366"
        d="M12 2a9.94 9.94 0 0 0-8.59 15L2 22l5.15-1.35A10 10 0 1 0 12 2Z"
      />
      <path
        fill="#fff"
        d="M16.6 13.83c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-1.96-1.21 7.35 7.35 0 0 1-1.36-1.69c-.14-.25 0-.38.11-.5.11-.12.25-.3.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.44.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.12.16 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z"
      />
    </svg>
  );
}

/** Logo officiel Google Calendar (construction 2020) : cadre multicolore
 *  bleu/jaune/vert + coins dark-blue et triangle rouge plié, « 31 » centré. */
function GoogleCalendarIcon() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      {/* centre blanc */}
      <path fill="#fff" d="M152.6 47.4H47.4v105.2h105.2z" />
      {/* L bleu : barre haute + barre gauche */}
      <path
        fill="#4285F4"
        d="M152.6 47.4V0H15.8C7.1 0 0 7.1 0 15.8v136.8h47.4V47.4z"
      />
      {/* barre droite jaune */}
      <path fill="#FBBC04" d="M152.6 47.4H200v105.2h-47.4z" />
      {/* barre basse verte */}
      <path fill="#34A853" d="M47.4 152.6h105.2V200H47.4z" />
      {/* coin bas-gauche vert foncé */}
      <path
        fill="#188038"
        d="M0 152.6v31.6C0 192.9 7.1 200 15.8 200h31.6v-47.4z"
      />
      {/* coin haut-droit bleu foncé */}
      <path
        fill="#1967D2"
        d="M200 47.4V15.8C200 7.1 192.9 0 184.2 0h-31.6v47.4z"
      />
      {/* coin plié bas-droit rouge */}
      <path fill="#EA4335" d="M152.6 200l47.4-47.4h-47.4z" />
      {/* le « 31 » */}
      <text
        x="100"
        y="124"
        textAnchor="middle"
        fontSize="68"
        fontWeight="500"
        fill="#1A73E8"
        fontFamily="'Google Sans', Roboto, system-ui, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

/** Logo officiel Gmail (2020) : enveloppe M quadricolore — barres bleue et
 *  verte, diagonale jaune, bandeau rouge, attache rouge foncé. */
function GmailIcon() {
  return (
    <svg viewBox="0 0 256 193" className="h-full w-full" aria-hidden>
      <path
        fill="#4285F4"
        d="M58.182 192.05V93.14L27.507 65.077 0 49.504v126.31c0 8.964 7.264 16.236 16.227 16.236h41.955Z"
      />
      <path
        fill="#34A853"
        d="M197.818 192.05h41.955c8.963 0 16.227-7.272 16.227-16.236V49.505l-31.156 17.837-27.026 25.798v98.91Z"
      />
      <path
        fill="#EA4335"
        d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.67 34.992-4.67 40.644L128 145.504z"
      />
      <path
        fill="#FBBC04"
        d="M197.818 17.504V93.14L256 49.504V25.668c0-20.03-22.864-31.452-38.4-19.418z"
      />
      <path
        fill="#C5221F"
        d="m0 49.504 26.759 20.07L58.182 93.14V17.504L41.6 6.25C26.018-5.785 0 5.639 0 25.668z"
      />
    </svg>
  );
}

/** Logo officiel Google Sheets : fichier vert #0F9D58, coin plié clair,
 *  tableau blanc 2 colonnes × 3 lignes. */
function GoogleSheetsIcon() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <path
        fill="#0F9D58"
        d="M37.5 0h87.5l50 50v137.5c0 6.9-5.6 12.5-12.5 12.5h-125c-6.9 0-12.5-5.6-12.5-12.5v-175C25 5.6 30.6 0 37.5 0z"
      />
      {/* coin plié */}
      <path fill="#87CEAC" d="M125 0l50 50h-50z" />
      {/* ombre sous le pli */}
      <path fill="#0C7B43" d="M125 50l12.5 12.5L125 50z" opacity=".4" />
      {/* tableau : cadre + cellules */}
      <path
        fill="#fff"
        d="M58.3 91.7v75h83.4v-75H58.3zm12.5 12.5h22.9v12.5H70.8v-12.5zm0 25h22.9v12.5H70.8v-12.5zm0 25h22.9v12.5H70.8v-12.5zm58.4 12.5h-22.9v-12.5h22.9v12.5zm0-25h-22.9v-12.5h22.9v12.5zm0-25h-22.9v-12.5h22.9v12.5z"
      />
    </svg>
  );
}
