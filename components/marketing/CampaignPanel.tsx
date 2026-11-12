"use client";

import { motion, useSpring, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useReducedMotionAfterMount } from "@/lib/use-reduced-motion-after-mount";

import { EASE } from "./Reveal";

// The "live campaign" card: Tamara's agents dialling a list in parallel.
// Shown inside the OutboundCalling section and as the sales landing hero visual.
// Dark surface only (white text on the command-centre background).

// Contacts de démo (fictifs) appelés dans la « campagne en direct ».
const CONTACTS = [
  { name: "Daniel Cohen", phone: "+972 50 000 0001" },
  { name: "Marie Dubois", phone: "+33 6 00 00 00 01" },
  { name: "Yossi Levi", phone: "+972 50 000 0002" },
  { name: "Sophie Martin", phone: "+33 6 00 00 00 02" },
  { name: "Noa Friedman", phone: "+972 50 000 0003" },
  { name: "Lucas Bernard", phone: "+33 6 00 00 00 03" },
] as const;

type RowState = "queued" | "calling" | "connected" | "qualified";

const PHONE_ICON = (
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
);

/** The live campaign card. `className` places it in its parent's grid. */
export function CampaignPanel({ className = "" }: { className?: string } = {}) {
  const t = useTranslations("OutboundCalling");
  const reduce = useReducedMotionAfterMount() ?? false;

  // Index de l'appel « en cours » qui descend la liste (effet live).
  // Init 0 = SSR stable. Le mode statique (reduced-motion) ne s'applique
  // qu'APRÈS hydratation via staticMode — useReducedMotion est null côté
  // serveur, brancher le premier render dessus créait un hydration mismatch
  // (badges queued/calling vs qualified/connected) pour les users concernés.
  const [active, setActive] = useState(0);
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bascule one-shot post-hydratation (évite le mismatch SSR), pattern voulu
      setStaticMode(true);
      return;
    }
    setStaticMode(false);
    const id = setInterval(
      () => setActive((i) => (i >= CONTACTS.length ? 0 : i + 1)),
      1600,
    );
    return () => clearInterval(id);
  }, [reduce]);

  const stateOf = (i: number): RowState => {
    if (staticMode)
      return i % 3 === 0 ? "qualified" : i % 3 === 1 ? "connected" : "queued";
    if (i < active) return i % 2 === 0 ? "qualified" : "connected";
    if (i === active) return "calling";
    return "queued";
  };

  // Lignes actuellement engagées (en train de composer ou en conversation)
  // → alimente le compteur « appels en parallèle ».
  const activeLines = CONTACTS.reduce(
    (n, _, i) =>
      n + (stateOf(i) === "calling" || stateOf(i) === "connected" ? 1 : 0),
    0,
  );

  return (
    <motion.div
      // Reduced motion: globals.css pins [data-reveal] to its final state from
      // the first paint (the preference is unknown during SSR).
      data-reveal=""
      initial={
        reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.96 }
      }
      whileInView={
        reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
      }
      viewport={{ once: true, margin: "-12% 0px -12% 0px" }}
      transition={
        reduce
          ? { duration: 0.2 }
          : { duration: 0.7, delay: 0.1, ease: EASE }
      }
      className={`overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_24px_64px_-24px_rgba(34,211,238,0.25)] backdrop-blur-xl ${className}`}
    >
      {/* Header de la carte */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#be185d] to-[#db2777] text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {PHONE_ICON}
            </svg>
          </span>
          <div className="text-start">
            <p className="font-display text-[15px] leading-tight text-white">
              {t("listTitle")}
            </p>
            <p className="text-[11px] text-white/70">{t("listSubtitle")}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
          />
          {t("live")}
        </span>
      </div>

      {/* Lignes : un numéro par contact */}
      <ul className="divide-y divide-white/[0.07]">
        {CONTACTS.map((c, i) => {
          const st = stateOf(i);
          return (
            <motion.li
              key={c.phone}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={
                reduce
                  ? { duration: 0.2 }
                  : { duration: 0.45, delay: 0.15 + i * 0.07, ease: EASE }
              }
              className={`flex items-center gap-3 px-5 py-3 transition-colors sm:px-6 ${st === "calling" ? "bg-[#db2777]/10" : ""}`}
            >
              {/* Avatar / icône d'appel + ripple sur la ligne qui compose */}
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                {st === "calling" && !reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-[#ec4899]/40"
                    animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  />
                )}
                <span
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm ${
                    st === "calling"
                      ? "bg-gradient-to-br from-[#be185d] to-[#db2777]"
                      : st === "queued"
                        ? "bg-white/15 text-white/70"
                        : "bg-gradient-to-br from-[#0e7490] to-[#22d3ee]"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {PHONE_ICON}
                  </svg>
                </span>
              </span>

              {/* Nom + numéro */}
              <div className="min-w-0 flex-1 text-start">
                <p className="truncate text-[13px] font-semibold text-white/90">
                  {c.name}
                </p>
                <p
                  className="truncate font-mono text-[12px] tabular-nums text-white/70"
                  dir="ltr"
                >
                  {c.phone}
                </p>
              </div>

              {/* Waveform d'activité sur les lignes en conversation */}
              {st === "connected" && <Waveform animate={!reduce} />}

              {/* Statut */}
              <StatusBadge state={st} t={t} />
            </motion.li>
          );
        })}
      </ul>

      {/* Compteur « appels en parallèle » */}
      <div className="flex items-center gap-3 border-t border-white/10 bg-white/[0.03] px-5 py-4 sm:px-6">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-[#22d3ee] motion-safe:animate-pulse"
        />
        <span className="font-display text-3xl tabular-nums leading-none text-white">
          <AnimatedCount value={activeLines} reduce={reduce} />
        </span>
        <span className="text-[13px] leading-snug text-white/70">
          {t("listSubtitle")}
        </span>
      </div>
    </motion.div>
  );
}

/** Nombre animé par spring — count-up doux à chaque changement de valeur. */
function AnimatedCount({ value, reduce }: { value: number; reduce: boolean }) {
  const spring = useSpring(value, { stiffness: 220, damping: 28 });
  const display = useTransform(spring, (v) => String(Math.round(v)));
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  if (reduce) return <span>{value}</span>;
  return <motion.span>{display}</motion.span>;
}

/** Mini waveform 5 barres (transform-only) sur les lignes connectées. */
const WAVE_HEIGHTS = [0.45, 0.9, 0.6, 1, 0.5] as const;

function Waveform({ animate }: { animate: boolean }) {
  return (
    <span aria-hidden className="flex h-4 shrink-0 items-end gap-[2.5px]">
      {WAVE_HEIGHTS.map((h, i) =>
        animate ? (
          <motion.span
            key={i}
            className="h-full w-[2.5px] origin-bottom rounded-full bg-[#22d3ee]"
            animate={{ scaleY: [h * 0.35, h, h * 0.5, h * 0.85, h * 0.35] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.12,
            }}
          />
        ) : (
          <span
            key={i}
            className="h-full w-[2.5px] origin-bottom rounded-full bg-[#22d3ee]"
            style={{ transform: `scaleY(${h * 0.7})` }}
          />
        ),
      )}
    </span>
  );
}

function StatusBadge({
  state,
  t,
}: {
  state: RowState;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<RowState, string> = {
    queued: "bg-white/10 text-white/70",
    calling: "bg-[#db2777]/20 text-[#f9a8d4]",
    connected: "bg-[#22d3ee]/15 text-[#67e8f9]",
    qualified: "bg-emerald-400/15 text-emerald-300",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${map[state]}`}
    >
      {state === "calling" && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
        />
      )}
      {state === "qualified" && (
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {t(`status_${state}`)}
    </span>
  );
}
