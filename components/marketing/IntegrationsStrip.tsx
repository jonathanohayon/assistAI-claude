"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

import { EASE } from "./Reveal";

/**
 * Bande intégrations sous le Hero — version playful « data flow ».
 * 3 cartes légèrement inclinées (posées comme des stickers) reliées par une
 * ligne de flux animée : des points voyagent entre les outils, façon « la
 * donnée circule en temps réel ». Hover : la carte se redresse et lève.
 */

const INTEGRATIONS = [
  {
    key: "whatsapp",
    icon: <WhatsAppIcon />,
    tilt: -2.5,
    glow: "shadow-[0_16px_40px_-12px_rgba(37,211,102,0.45)]",
    ring: "hover:ring-[#25D366]/50",
    chipBg: "bg-[#25D366]/10",
  },
  {
    key: "calendar",
    icon: <GoogleCalendarIcon />,
    tilt: 1.8,
    glow: "shadow-[0_16px_40px_-12px_rgba(66,133,244,0.45)]",
    ring: "hover:ring-[#4285F4]/50",
    chipBg: "bg-[#4285F4]/10",
  },
  {
    key: "crm",
    icon: <GoogleSheetsIcon />,
    tilt: -1.5,
    glow: "shadow-[0_16px_40px_-12px_rgba(15,157,88,0.45)]",
    ring: "hover:ring-[#0F9D58]/50",
    chipBg: "bg-[#0F9D58]/10",
  },
] as const;

export function IntegrationsStrip() {
  const t = useTranslations("Integrations");
  const reduce = useReducedMotion();

  return (
    <section
      aria-label={t("kicker")}
      className="relative overflow-hidden py-14 sm:py-16"
    >
      {/* Voile gradient très léger pour détacher la bande du fond rose */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-56 -translate-y-1/2 bg-[radial-gradient(60%_100%_at_50%_50%,rgba(34,211,238,0.08),transparent_70%)]"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        {/* Kicker avec dot "live" */}
        <motion.p
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.55, ease: EASE }}
          className="flex items-center justify-center gap-2 text-center text-[11px] font-bold uppercase tracking-[0.24em]"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22d3ee]" />
          </span>
          <span className="bg-gradient-to-r from-[#0e7490] via-[#db2777] to-[#0e7490] bg-clip-text text-transparent">
            {t("kicker")}
          </span>
        </motion.p>

        {/* Cartes + ligne de flux derrière */}
        <div className="relative mt-8">
          {/* Ligne de flux : pointillés + 2 points qui voyagent (desktop) */}
          <div
            aria-hidden
            dir="ltr"
            className="pointer-events-none absolute inset-x-[12%] top-1/2 hidden -translate-y-1/2 lg:block"
          >
            <div className="h-px w-full border-t-2 border-dashed border-[#db2777]/20" />
            {!reduce && (
              <>
                <span className="flow-dot bg-[#22d3ee] shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
                <span
                  className="flow-dot bg-[#db2777] shadow-[0_0_12px_rgba(219,39,119,0.8)]"
                  style={{ animationDelay: "1.6s" }}
                />
              </>
            )}
          </div>

          <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
            {INTEGRATIONS.map((item, i) => (
              <motion.div
                key={item.key}
                initial={
                  reduce
                    ? { opacity: 0 }
                    : { opacity: 0, y: 32, rotate: 0, scale: 0.9 }
                }
                whileInView={
                  reduce
                    ? { opacity: 1 }
                    : { opacity: 1, y: 0, rotate: item.tilt, scale: 1 }
                }
                viewport={{ once: true, margin: "-12%" }}
                transition={
                  reduce
                    ? { duration: 0.2 }
                    : {
                        delay: 0.12 + i * 0.12,
                        type: "spring",
                        stiffness: 220,
                        damping: 18,
                      }
                }
                whileHover={
                  reduce
                    ? undefined
                    : { rotate: 0, y: -8, scale: 1.04 }
                }
                className={`group flex cursor-default items-center gap-3.5 rounded-3xl border border-white/60 bg-white/85 p-4 ring-1 ring-[#fbcfe8]/60 backdrop-blur-xl transition-shadow duration-300 ${item.glow} ${item.ring} sm:p-5`}
              >
                {/* Icône flottante dans un squircle teinté marque */}
                <motion.span
                  aria-hidden
                  animate={
                    reduce
                      ? undefined
                      : { y: [0, -4, 0] }
                  }
                  transition={
                    reduce
                      ? undefined
                      : {
                          duration: 2.6,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: i * 0.4,
                        }
                  }
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${item.chipBg} p-2.5 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:scale-100`}
                >
                  {item.icon}
                </motion.span>
                <span className="text-[13.5px] font-semibold leading-snug text-[#1e2937]">
                  {t(item.key)}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        .flow-dot {
          position: absolute;
          top: -3px;
          left: 0;
          height: 6px;
          width: 6px;
          border-radius: 9999px;
          animation: flow-travel 3.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        @keyframes flow-travel {
          0% {
            left: 0%;
            opacity: 0;
            transform: scale(0.5);
          }
          12% {
            opacity: 1;
            transform: scale(1);
          }
          88% {
            opacity: 1;
            transform: scale(1);
          }
          100% {
            left: 100%;
            opacity: 0;
            transform: scale(0.5);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .flow-dot {
            animation: none;
            display: none;
          }
        }
      `}</style>
    </section>
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
