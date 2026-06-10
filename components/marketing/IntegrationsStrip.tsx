"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

import { EASE } from "./Reveal";

/**
 * Bande intégrations — pattern « integrations cloud » (cnblocks / 21st.dev) :
 * un cluster centré de tuiles logos, Tamara au milieu avec des anneaux qui
 * pulsent, les 3 outils autour. Sobre, premium, une seule idée visuelle :
 * « tout converge vers Tamara ».
 */

const TOOLS = [
  { key: "whatsapp", icon: <WhatsAppIcon /> },
  { key: "calendar", icon: <GoogleCalendarIcon /> },
  { key: "crm", icon: <GoogleSheetsIcon /> },
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

  return (
    <section
      aria-label={t("kicker")}
      className="relative overflow-hidden py-16 sm:py-20"
    >
      {/* Glow radial doux derrière le cluster */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[42%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.14),rgba(219,39,119,0.08),transparent)] blur-2xl"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        {/* Cluster : WhatsApp au-dessus, Calendar · TAMARA · Sheets au centre */}
        <div className="mx-auto flex w-fit flex-col items-center gap-3">
          <motion.div {...pop(0.25)}>
            <Tile>{TOOLS[0].icon}</Tile>
          </motion.div>

          <div className="flex items-center gap-3">
            <motion.div {...pop(0.35)}>
              <Tile>{TOOLS[1].icon}</Tile>
            </motion.div>

            {/* Tuile Tamara — plus grande, gradient marque, anneaux pulsants */}
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
              <div className="relative flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#db2777] to-[#22d3ee] shadow-[0_16px_40px_-12px_rgba(219,39,119,0.5)] ring-1 ring-white/40">
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
              </div>
            </motion.div>

            <motion.div {...pop(0.45)}>
              <Tile>{TOOLS[2].icon}</Tile>
            </motion.div>
          </div>
        </div>

        {/* Texte sous le cluster */}
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ delay: 0.5, duration: 0.6, ease: EASE }}
          className="mx-auto mt-8 max-w-2xl text-center"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#0e7490]">
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
    <div className="group flex size-16 items-center justify-center rounded-2xl border border-[#fbcfe8] bg-white/90 p-3.5 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-[#22d3ee]/50 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
    <span aria-hidden className="h-full w-full">
        {children}
      </span>
    </div>
  );
}

/* ----------------------------- brand icons -------------------------------- */
/* Logos officiels simplifiés, viewBox 24, couleurs marque — pas d'emoji.     */

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

function GoogleCalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" fill="#fff" />
      <path d="M3 8h18v3H3z" fill="#4285F4" />
      <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3V6Z" fill="#1967D2" />
      <rect
        x="3"
        y="4"
        width="18"
        height="17"
        rx="2"
        fill="none"
        stroke="#1967D2"
        strokeWidth="1.2"
      />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill="#1967D2"
        fontFamily="system-ui, sans-serif"
      >
        17
      </text>
    </svg>
  );
}

function GoogleSheetsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="#0F9D58"
      />
      <path d="M14 2v5h5l-5-5Z" fill="#87CEAC" />
      <path
        d="M8 11h8v7H8v-7Zm1.5 1.5v1.25h2v-1.25h-2Zm3.5 0v1.25h2v-1.25h-2Zm-3.5 2.5v1.25h2V15h-2Zm3.5 0v1.25h2V15h-2Z"
        fill="#fff"
      />
    </svg>
  );
}
