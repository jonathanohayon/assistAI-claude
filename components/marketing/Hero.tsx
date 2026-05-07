"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import VoiceAgent from "@/components/VoiceAgent";

const HERO_WORDS = ["Une", "secrétaire", "vocale", "qui", "ne", "rate", "aucun", "appel."];

export function Hero() {
  const reduce = useReducedMotion();

  const wordVariants = reduce
    ? { hidden: {}, visible: {} }
    : {
        hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
        visible: {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-36 sm:pb-28">
      {/* Animated mesh */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.6 }}
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      {/* Floating orbs */}
      <motion.div
        aria-hidden
        animate={
          reduce
            ? {}
            : { y: [0, -20, 0], x: [0, 12, 0] }
        }
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute right-[10%] top-[18%] -z-10 h-64 w-64 rounded-full bg-gradient-to-br from-[#f9a8d4] to-[#c4b5fd] opacity-40 blur-3xl"
      />
      <motion.div
        aria-hidden
        animate={
          reduce ? {} : { y: [0, 30, 0], x: [0, -16, 0] }
        }
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="pointer-events-none absolute -left-10 top-[40%] -z-10 h-80 w-80 rounded-full bg-gradient-to-br from-[#fbcfe8] to-[#ddd6fe] opacity-50 blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-success)]" />
            </span>
            Conciergerie vocale temps réel · Live
          </motion.div>

          <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-[var(--color-foreground)] sm:text-6xl lg:text-7xl">
            <motion.span
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.07, delayChildren: 0.2 }}
              className="inline-block"
            >
              {HERO_WORDS.map((w, i) => (
                <motion.span
                  key={i}
                  variants={wordVariants}
                  className="mr-[0.25em] inline-block"
                >
                  {w === "rate" ? (
                    <span className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] bg-clip-text text-transparent">
                      {w}
                    </span>
                  ) : (
                    w
                  )}
                </motion.span>
              ))}
            </motion.span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.6 }}
            className="mt-7 max-w-xl text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg"
          >
            Pour les cabinets médicaux, salons de beauté et coiffeurs.
            Une IA vocale qui décroche 24/7, prend les rendez-vous, gère les
            annulations, et synchronise votre agenda — en français et en hébreu.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.05, duration: 0.6 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              href="#demo"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">Essayer la démo en direct</span>
              <svg viewBox="0 0 24 24" fill="none" className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-6 py-3 text-sm font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur transition-colors hover:bg-white"
            >
              Configurer mon agent
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.6 }}
            className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs text-[var(--color-muted-foreground)]"
          >
            <Stat value="24/7" label="Disponibilité" />
            <Divider />
            <Stat value="<300ms" label="Latence vocale" />
            <Divider />
            <Stat value="2" label="Langues · 🇫🇷 🇮🇱" />
            <Divider />
            <Stat value="∞" label="Appels simultanés" />
          </motion.div>
        </div>

        {/* Voice demo */}
        <motion.div
          id="demo"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-5"
        >
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-3 rounded-[2.75rem] bg-gradient-to-br from-[#fbcfe8]/60 via-transparent to-[#c4b5fd]/40 blur-2xl"
            />
            <div className="relative rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_24px_60px_-20px_rgb(131_24_67_/_0.18)] backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-display text-lg text-[var(--color-foreground)]">
                    Démo en direct
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Parlez à Johana depuis votre navigateur
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-muted)] px-2.5 py-1 text-[11px] text-[var(--color-foreground)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-primary)]" />
                  WebRTC
                </span>
              </div>
              <VoiceAgent />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-2xl text-[var(--color-foreground)]">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="hidden h-8 w-px bg-[var(--color-border)] sm:inline-block" />;
}
