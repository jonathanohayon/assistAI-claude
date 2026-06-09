"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

// Section marketing « Appels sortants » — version simple : une liste de
// numéros que l'agent IA appelle en direct, avec les cas d'usage Sales /
// Marketing / Lead mis en relief. Style aligné sur la landing (glass
// magenta/cyan, font-display, motion whileInView, reduced-motion).

const EASE = [0.16, 1, 0.3, 1] as const;

// Contacts de démo (fictifs) appelés dans la « campagne en direct ».
const CONTACTS = [
  { name: "Daniel Cohen", phone: "+972 54 812 4471" },
  { name: "Marie Dubois", phone: "+33 6 24 88 19 03" },
  { name: "Yossi Levi", phone: "+972 52 337 9920" },
  { name: "Sophie Martin", phone: "+33 7 61 45 92 10" },
  { name: "Noa Friedman", phone: "+972 58 901 2256" },
  { name: "Lucas Bernard", phone: "+33 6 09 73 51 88" },
] as const;

type RowState = "queued" | "calling" | "connected" | "qualified";

export function OutboundCalling() {
  const t = useTranslations("OutboundCalling");
  const reduce = useReducedMotion() ?? false;

  // Index de l'appel « en cours » qui descend la liste (effet live).
  const [active, setActive] = useState(reduce ? CONTACTS.length : 0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(
      () => setActive((i) => (i >= CONTACTS.length ? 0 : i + 1)),
      1600,
    );
    return () => clearInterval(id);
  }, [reduce]);

  const stateOf = (i: number): RowState => {
    if (reduce) return i % 3 === 0 ? "qualified" : i % 3 === 1 ? "connected" : "queued";
    if (i < active) return i % 2 === 0 ? "qualified" : "connected";
    if (i === active) return "calling";
    return "queued";
  };

  const USE_CASES = [
    {
      key: "sales",
      accent: "from-[#be185d] to-[#ec4899]",
      tint: "text-[#be185d]",
      ring: "ring-[#fbcfe8]",
      icon: (
        <path d="M3 3v18h18M19 9l-5 5-4-4-4 4" />
      ),
    },
    {
      key: "lead",
      accent: "from-[#0e7490] to-[#22d3ee]",
      tint: "text-[#0e7490]",
      ring: "ring-[#a5f3fc]",
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
      tint: "text-[#db2777]",
      ring: "ring-[#fbcfe8]",
      icon: (
        <path d="M3 11v3a1 1 0 0 0 1 1h3l4 4V7L7 11H4a1 1 0 0 0-1 0ZM16 8a5 5 0 0 1 0 8M19.5 5a9 9 0 0 1 0 14" />
      ),
    },
  ] as const;

  return (
    <section id="outbound" className="relative py-24 sm:py-32">
      {/* Blobs décoratifs (même langage que les autres sections) */}
      <div className="pointer-events-none absolute left-[-8%] top-1/4 h-96 w-96 rounded-full bg-[#22d3ee]/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6%] top-2/3 h-80 w-80 rounded-full bg-[#f472b6]/12 blur-3xl" />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        {/* En-tête */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[#be185d]/25 bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#be185d] shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[#be185d] motion-safe:animate-pulse" />
            {t("kicker")}
          </span>
          <h2 className="mt-4 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start lg:gap-8">
          {/* Cas d'usage mis en relief */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            {USE_CASES.map((u, i) => (
              <motion.div
                key={u.key}
                initial={{ opacity: 0, x: -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: EASE }}
                whileHover={{ y: -4 }}
                className="group flex items-start gap-4 rounded-[1.5rem] border border-white/50 bg-white/65 p-5 shadow-[0_8px_28px_-14px_rgba(190,24,93,0.15)] backdrop-blur-xl transition-shadow hover:shadow-[0_20px_48px_-18px_rgba(190,24,93,0.28)]"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${u.accent} text-white shadow-md ring-2 ring-white/70 transition-transform group-hover:rotate-3 group-hover:scale-110`}>
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {u.icon}
                  </svg>
                </span>
                <div className="min-w-0">
                  <h3 className={`font-display text-lg tracking-tight ${u.tint}`}>
                    {t(`use_${u.key}_title`)}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">
                    {t(`use_${u.key}_desc`)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Carte « campagne en direct » : la liste de numéros appelés */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
            className="overflow-hidden rounded-[2rem] border border-white/50 bg-white/70 shadow-[0_16px_48px_-18px_rgba(190,24,93,0.22)] backdrop-blur-xl lg:col-span-3"
          >
            {/* Header de la carte */}
            <div className="flex items-center justify-between gap-3 border-b border-[#f1eef5] bg-gradient-to-br from-white/70 to-white/30 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#be185d] to-[#22d3ee] text-white shadow-sm">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <div>
                  <p className="font-display text-[15px] leading-tight text-[#18181b]">{t("listTitle")}</p>
                  <p className="text-[11px] text-[#64748b]">{t("listSubtitle")}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#166534]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] motion-safe:animate-pulse" />
                {t("live")}
              </span>
            </div>

            {/* Lignes : un numéro par contact */}
            <ul className="divide-y divide-[#f1eef5]">
              {CONTACTS.map((c, i) => {
                const st = stateOf(i);
                return (
                  <motion.li
                    key={c.phone}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-20px" }}
                    transition={{ duration: 0.45, delay: 0.15 + i * 0.07, ease: EASE }}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors sm:px-6 ${st === "calling" ? "bg-[#fdf2f8]/70" : ""}`}
                  >
                    {/* Avatar / icône d'appel */}
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                      {st === "calling" && !reduce && (
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-full bg-[#be185d]/30"
                          animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                        />
                      )}
                      <span className={`relative flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm ${st === "calling" ? "bg-gradient-to-br from-[#be185d] to-[#ec4899]" : st === "queued" ? "bg-[#cbd5e1]" : "bg-gradient-to-br from-[#0e7490] to-[#22d3ee]"}`}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                      </span>
                    </span>

                    {/* Nom + numéro */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#18181b]">{c.name}</p>
                      <p className="truncate font-mono text-[12px] tabular-nums text-[#64748b]" dir="ltr">{c.phone}</p>
                    </div>

                    {/* Statut */}
                    <StatusBadge state={st} t={t} />
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
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
    queued: "bg-[#f1f5f9] text-[#64748b]",
    calling: "bg-[#fce7f3] text-[#be185d]",
    connected: "bg-[#cffafe] text-[#0e7490]",
    qualified: "bg-[#dcfce7] text-[#166534]",
  };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${map[state]}`}>
      {state === "calling" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      )}
      {state === "qualified" && (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {t(`status_${state}`)}
    </span>
  );
}
