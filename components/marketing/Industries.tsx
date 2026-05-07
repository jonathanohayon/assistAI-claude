"use client";

import { motion } from "motion/react";

const INDUSTRIES = [
  {
    title: "Cabinets médicaux",
    desc: "Prise de RDV, rappels, annulations, triage des urgences. Conforme au secret médical.",
    accent: "from-[#fce7f3] to-[#fbcfe8]",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    features: ["Synchro Doctolib / agenda", "Rappels SMS automatiques", "Filtre les urgences"],
  },
  {
    title: "Salons de beauté",
    desc: "Prestations soin, durée variable, choix des praticiennes. Multi-centres natif.",
    accent: "from-[#ede9fe] to-[#ddd6fe]",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M12 2c0 5-4 7-4 11a4 4 0 0 0 8 0c0-4-4-6-4-11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="12" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    features: ["Multi-centres", "Durée par prestation", "Fidélité automatique"],
  },
  {
    title: "Coiffeurs",
    desc: "Réservation rapide, gestion des temps de pose, propose les créneaux libres au calé.",
    accent: "from-[#fef3c7] to-[#fde68a]",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M6 19c0-3 2-5 4-7M18 19c0-3-2-5-4-7M12 4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="6" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    features: ["Optimisation des créneaux", "Gestion temps de pose", "Notifications client"],
  },
];

export function Industries() {
  return (
    <section id="industries" className="relative py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Pour qui
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">
            Pensé pour les métiers où chaque appel compte.
          </h2>
          <p className="mt-4 text-base text-[var(--color-muted-foreground)] sm:text-lg">
            Une seule plateforme, configurable en quelques minutes pour le ton
            et les workflows propres à votre métier.
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {INDUSTRIES.map((ind, i) => (
            <motion.div
              key={ind.title}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.7,
                delay: i * 0.1,
                ease: [0.16, 1, 0.3, 1],
              }}
              whileHover={{ y: -6 }}
              className="group relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm transition-shadow hover:shadow-lg"
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br ${ind.accent} opacity-60 blur-2xl transition-opacity group-hover:opacity-90`}
              />
              <div className="relative">
                <div
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${ind.accent} text-[var(--color-primary)]`}
                >
                  {ind.icon}
                </div>

                <h3 className="mt-5 font-display text-xl text-[var(--color-foreground)]">
                  {ind.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {ind.desc}
                </p>

                <ul className="mt-5 space-y-2 border-t border-[var(--color-border)]/60 pt-4">
                  {ind.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm text-[var(--color-foreground)]"
                    >
                      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-[var(--color-primary)]">
                        <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
