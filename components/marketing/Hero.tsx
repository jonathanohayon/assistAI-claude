"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EASE } from "./Reveal";

/** Sparkles réduits à 3, très subtils (opacité max 0.7, tailles 3–4px).
 *  Positions hardcodées déterministes — pas de SSR mismatch. */
const SPARKLES = [
  { top: "-6%", left: "8%", size: 4, color: "#22D3EE", delay: 0 },
  { top: "38%", left: "95%", size: 4, color: "#22D3EE", delay: 0.8 },
  { top: "78%", left: "58%", size: 3, color: "#BE185D", delay: 1.4 },
];

/**
 * Hero — full-bleed avec vidéo de fond + overlay gradient. Titre centré
 * en grand, 2 CTAs. Pièce maîtresse : parallaxe de sortie scroll-driven —
 * le contenu remonte et fade pendant que la vidéo zoome légèrement quand
 * on quitte le hero. La démo VoiceAgent vit dans `<TryDemo />` (#demo).
 */
export function Hero() {
  const t = useTranslations("Hero");
  const reduce = useReducedMotion();

  const emphasis = t("titleEmphasis");
  const titleTemplate = t("title", { emphasis: ` ${emphasis} ` });
  const titleParts = titleTemplate.split(" ");

  const wordVariants = reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
      }
    : {
        hidden: { opacity: 0, y: 30, filter: "blur(10px)" },
        visible: {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          transition: { duration: 0.65, ease: EASE },
        },
      };

  const fadeUp = (delay: number) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.2 },
        }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.6, ease: EASE },
        };

  // ── Parallaxe de sortie scroll-driven ──────────────────────────────
  // Quand on scrolle hors du hero : le contenu translate vers le haut et
  // fade, la vidéo scale légèrement derrière. Progress 0 = hero plein
  // écran, 1 = hero entièrement sorti par le haut.
  const sectionRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const videoScale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  // ── Scroll-driven underline pour le mot emphasis (signature) ───────
  // scaleX 0 (top of page) → 1 quand l'user commence à scroller.
  const { scrollY } = useScroll();
  const underlineProgress = useTransform(scrollY, [0, 400], [0, 1]);
  const underlineScaleX = useSpring(underlineProgress, {
    stiffness: 120,
    damping: 24,
    restDelta: 0.001,
  });

  // ── Magnetic CTA ─────────────────────────────────────────────────
  const ctaRef = useRef<HTMLAnchorElement | null>(null);
  const magX = useMotionValue(0);
  const magY = useMotionValue(0);
  const springX = useSpring(magX, { stiffness: 220, damping: 18 });
  const springY = useSpring(magY, { stiffness: 220, damping: 18 });
  const isTouchRef = useRef(false);

  useEffect(() => {
    const onTouch = () => {
      isTouchRef.current = true;
    };
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  const onCtaMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (reduce || isTouchRef.current) return;
      const el = ctaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const radius = Math.max(rect.width, rect.height) / 2 + 60;
      if (dist > radius) {
        magX.set(0);
        magY.set(0);
        return;
      }
      const strength = 8 / radius;
      magX.set(dx * strength);
      magY.set(dy * strength);
    },
    [magX, magY, reduce],
  );

  const onCtaLeave = useCallback(() => {
    magX.set(0);
    magY.set(0);
  }, [magX, magY]);

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden pt-32 pb-32 sm:pt-40 sm:pb-40 lg:min-h-[88vh]"
    >
      {/* Vidéo de fond servie localement depuis /public/videos — pas de CDN
       *  tiers, pas de CORS, pas de cache external. `isolate` sur la section
       *  crée un stacking context propre pour que les z-index négatifs des
       *  overlays restent contenus ici. Scale scroll-driven (1→1.08) pour la
       *  parallaxe de sortie. */}
      <motion.video
        aria-hidden
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        src="/videos/hero-bg.mp4"
        style={reduce ? undefined : { scale: videoScale }}
        className="absolute inset-0 -z-30 h-full w-full object-cover"
      />

      {/* Voile sombre vertical pour lisibilité du texte clair par-dessus la
       *  vidéo. ZÉRO blanc — on garde la vidéo nette, on assombrit juste
       *  légèrement haut + bas pour faire ressortir badge et CTAs. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 bg-gradient-to-b from-black/35 via-black/10 to-black/45"
      />

      {/* Content centré — translate + fade quand on scrolle hors du hero. */}
      <motion.div
        style={reduce ? undefined : { y: contentY, opacity: contentOpacity }}
        className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 text-center"
      >
        {/* Badge live */}
        <motion.div
          {...fadeUp(0.1)}
          className="inline-flex items-center gap-2 rounded-full border border-[#22d3ee]/40 bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0e7490] shadow-sm backdrop-blur"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-[#22d3ee] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22d3ee]" />
          </span>
          {t("badge")}
        </motion.div>

        {/* H1 + 3 sparkles subtils autour */}
        <div className="relative mt-8">
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
            {SPARKLES.map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full"
                style={{
                  top: s.top,
                  left: s.left,
                  width: s.size,
                  height: s.size,
                  backgroundColor: s.color,
                  boxShadow: `0 0 8px ${s.color}66`,
                }}
                animate={
                  reduce
                    ? { opacity: 0.4, scale: 1 }
                    : { opacity: [0, 0.7, 0], scale: [0.5, 1, 0.5] }
                }
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        duration: 3.2,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: s.delay,
                      }
                }
              />
            ))}
          </div>

          <h1
            className="relative z-10 font-display text-5xl leading-[0.95] tracking-tight text-white sm:text-7xl lg:text-[88px]"
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.35)" }}
          >
            <motion.span
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.05, delayChildren: 0.25 }}
              className="inline"
            >
              {titleParts.map((w, i) => {
                const trimmed = w.trim();
                if (!trimmed) return null;
                return (
                  <motion.span
                    key={i}
                    variants={wordVariants}
                    className="me-[0.22em] inline-block"
                  >
                    {trimmed === emphasis ? (
                      <span
                        className="relative inline-block text-[#ff4d8d]"
                        style={{
                          textShadow:
                            "0 2px 18px rgba(255,77,141,0.45), 0 1px 4px rgba(0,0,0,0.35)",
                        }}
                      >
                        {trimmed}
                        {/* Underline scroll-driven : scaleX 0 → 1 quand l'user
                         *  commence à scroller en bas du hero. Brush stroke
                         *  brand-gradient ancré au centre (RTL-safe). */}
                        <motion.span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 -bottom-1 h-[6px] rounded-full"
                          style={{
                            scaleX: reduce ? 1 : underlineScaleX,
                            transformOrigin: "center",
                            background:
                              "linear-gradient(90deg, #ec4899 0%, #fb7185 50%, #22d3ee 100%)",
                            boxShadow:
                              "0 4px 16px -2px rgba(236,72,153,0.5)",
                          }}
                        />
                      </span>
                    ) : (
                      trimmed
                    )}
                  </motion.span>
                );
              })}
            </motion.span>
          </h1>
        </div>

        <motion.p
          {...fadeUp(0.7)}
          className="mt-7 max-w-2xl text-base leading-relaxed text-white/90 sm:text-lg lg:text-xl"
          style={{ textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}
        >
          {t("subtitle")}
        </motion.p>

        {/* Stats inline — rangée resserrée */}
        <div className="mt-8 flex flex-wrap items-end justify-center gap-x-4 gap-y-3 sm:gap-x-6">
          <Stat
            value="24/7"
            label={t("stats.availability")}
            delay={0.85}
            reduce={!!reduce}
          />
          <Divider />
          <Stat
            value="<300ms"
            label={t("stats.latency")}
            delay={0.93}
            reduce={!!reduce}
          />
          <Divider />
          <Stat
            value="Multi"
            label={t("stats.languages")}
            delay={1.01}
            reduce={!!reduce}
          />
          <Divider />
          <Stat
            value="∞"
            label={t("stats.calls")}
            delay={1.09}
            reduce={!!reduce}
          />
        </div>

        {/* CTAs — 2 seulement : signup magnétique + live demo cyan */}
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          transition={
            reduce
              ? { duration: 0.2 }
              : { delay: 1.15, type: "spring", stiffness: 240, damping: 20 }
          }
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <motion.div
            style={reduce ? undefined : { x: springX, y: springY }}
            onMouseMove={onCtaMouseMove}
            onMouseLeave={onCtaLeave}
            className="inline-block"
          >
            <Link
              ref={ctaRef}
              href="/signup"
              className="cta-glow group relative inline-flex cursor-pointer items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-8 py-4 text-base font-semibold text-white shadow-lg ring-2 ring-[#22d3ee]/40 transition-all hover:scale-[1.03] hover:shadow-xl active:scale-95"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">{t("ctaDemo")}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              >
                <path
                  d="M5 12h14M13 5l7 7-7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </motion.div>

          {/* CTA Live Demo : scroll vers la section #demo (TryDemo). Bordure
           *  cyan animée + onde sonore (3 barres pulsantes) à côté du label
           *  pour signaler "parle live maintenant". */}
          <Link
            href="#demo"
            aria-label={t("ctaLiveDemo")}
            className="group relative inline-flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-full border-2 border-[#22d3ee]/70 bg-[#22d3ee]/15 px-7 py-4 text-base font-semibold text-white shadow-[0_8px_28px_-8px_rgba(34,211,238,0.55)] backdrop-blur-md transition-all hover:scale-[1.03] hover:border-[#22d3ee] hover:bg-[#22d3ee]/25"
          >
            {/* Pulse halo cyan derrière */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full bg-[#22d3ee]/0 motion-safe:animate-pulse"
              style={{
                boxShadow: "0 0 0 0 rgba(34,211,238,0.5)",
                animation: "live-demo-halo 2.4s ease-in-out infinite",
              }}
            />
            {/* Onde sonore : 3 barres qui battent en cadence */}
            <span
              aria-hidden
              className="relative flex items-center gap-[3px]"
            >
              {[0, 0.15, 0.3].map((delay, i) => (
                <span
                  key={i}
                  className="block w-[3px] rounded-full bg-white"
                  style={{
                    height: 16,
                    animation: `live-demo-wave 1s ease-in-out ${delay}s infinite`,
                    transformOrigin: "center",
                  }}
                />
              ))}
            </span>
            <span className="relative">{t("ctaLiveDemo")}</span>
          </Link>
        </motion.div>
      </motion.div>

      <style jsx>{`
        .cta-glow {
          animation: cta-glow 2.4s ease-in-out infinite;
        }
        @keyframes cta-glow {
          0%,
          100% {
            box-shadow:
              0 10px 30px -10px rgba(190, 24, 93, 0.45),
              0 0 0 0 rgba(34, 211, 238, 0);
          }
          50% {
            box-shadow:
              0 14px 40px -10px rgba(190, 24, 93, 0.55),
              0 0 0 12px rgba(34, 211, 238, 0.20);
          }
        }
        @keyframes live-demo-wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
        @keyframes live-demo-halo {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(34,211,238,0);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(34,211,238,0.18);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cta-glow {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}

function Stat({
  value,
  label,
  delay,
  reduce,
}: {
  value: string;
  label: string;
  delay: number;
  reduce: boolean;
}) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (reduce) return;
    const target = Number(value);
    if (
      !Number.isFinite(target) ||
      !Number.isInteger(target) ||
      target <= 0
    )
      return;
    const start = performance.now();
    const duration = 800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(String(Math.round(target * eased)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const startTimer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay * 1000);
    return () => {
      window.clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [value, delay, reduce]);

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{
        delay,
        duration: reduce ? 0.2 : 0.5,
        ease: EASE,
      }}
      className="text-center"
    >
      <p
        className="font-display text-3xl font-bold tracking-tight tabular-nums text-white sm:text-4xl"
        style={{ textShadow: "0 2px 12px rgba(0,0,0,0.45)" }}
      >
        {display}
      </p>
      <p
        className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/75"
        style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}
      >
        {label}
      </p>
    </motion.div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="hidden h-10 w-px bg-gradient-to-b from-transparent via-[#be185d]/25 to-transparent sm:inline-block"
    />
  );
}
