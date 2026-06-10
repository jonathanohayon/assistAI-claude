"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { EASE, Reveal, Stagger, StaggerItem } from "./Reveal";

// Stats hardcoded per industry — chiffres "estimés" issus de cas client moyens.
// À remplacer par data DB réelle quand l'instrumentation tracking sera en place.
const INDUSTRY_STATS = {
  medical: { rdv: 89, manques: 42 },
  beauty: { rdv: 76, manques: 38 },
  barber: { rdv: 82, manques: 45 },
} as const;

const INDUSTRIES = [
  {
    key: "medical" as const,
    accent: "from-[#fb7185]/15 to-[#22d3ee]/10",
    iconBg: "from-[#be185d] to-[#ec4899]",
    image:
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Cabinet médical / dentaire",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" className="h-7 w-7">
        <path d="M9 3v6H3v6h6v6h6v-6h6V9h-6V3H9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "beauty" as const,
    accent: "from-[#f472b6]/15 to-[#22d3ee]/10",
    iconBg: "from-[#ec4899] to-[#be185d]",
    image:
      "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Institut de beauté",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
        <path d="M12 2c0 5-4 7-4 11a4 4 0 0 0 8 0c0-4-4-6-4-11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="12" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    key: "barber" as const,
    accent: "from-[#22d3ee]/15 to-[#ec4899]/10",
    iconBg: "from-[#0e7490] to-[#22d3ee]",
    image:
      "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Barbershop",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" className="h-7 w-7">
        <path d="M6 19c0-3 2-5 4-7M18 19c0-3-2-5-4-7M12 4v8" stroke="currentColor" strokeWidth="2" />
        <circle cx="6" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="20" r="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
];

export function Industries() {
  const t = useTranslations("Industries");

  return (
    <section id="industries" className="relative py-24 sm:py-32">
      {/* Blob décoratif subtil — pas de mesh full, juste une touche */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-1/4 top-1/4 h-96 w-96 rounded-full bg-gradient-to-br from-[#fb7185]/8 to-[#22d3ee]/8 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </Reveal>

        <Stagger className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {INDUSTRIES.map((ind) => (
            <StaggerItem key={ind.key} className="h-full">
              <IndustryCard ind={ind} t={t} stats={INDUSTRY_STATS[ind.key]} />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/** Tilt max en degrés (±) — léger, jamais gadget. */
const MAX_TILT = 4.5;

const HOVER_MEDIA = "(hover: hover) and (pointer: fine)";
function subscribeHoverMedia(onChange: () => void) {
  const mq = window.matchMedia(HOVER_MEDIA);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function IndustryCard({
  ind,
  t,
  stats,
}: {
  ind: (typeof INDUSTRIES)[number];
  t: ReturnType<typeof useTranslations<"Industries">>;
  stats: { rdv: number; manques: number };
}) {
  const reduce = useReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Tilt 3D uniquement sur device à souris (jamais tactile / reduced-motion).
  // useSyncExternalStore : abonnement matchMedia sans setState-in-effect,
  // et `false` côté serveur (pas de tilt au SSR).
  const canHover = useSyncExternalStore(
    subscribeHoverMedia,
    () => window.matchMedia(HOVER_MEDIA).matches,
    () => false,
  );
  const tiltEnabled = canHover && !reduce;

  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rotateX = useSpring(tiltX, { stiffness: 260, damping: 24 });
  const rotateY = useSpring(tiltY, { stiffness: 260, damping: 24 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tiltEnabled || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 → 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    tiltY.set(px * MAX_TILT * 2);
    tiltX.set(-py * MAX_TILT * 2);
  };
  const handleMouseLeave = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  // Parallaxe photo au scroll — la card sert de référence, l'image glisse de ±12px.
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start end", "end start"],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], [-12, 12]);

  return (
    <div ref={wrapperRef} className="h-full" style={{ perspective: 1000 }}>
      <motion.div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={
          tiltEnabled
            ? { rotateX, rotateY, transformStyle: "preserve-3d" }
            : undefined
        }
        whileHover={tiltEnabled ? { scale: 1.01 } : undefined}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="group relative flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/50 bg-white/65 p-7 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.15)] backdrop-blur-xl transition-[border-color,box-shadow] hover:border-[#22d3ee]/40 hover:shadow-[0_16px_48px_-16px_rgba(34,211,238,0.25)]"
      >
        <div
          aria-hidden
          className={`pointer-events-none absolute -end-12 -top-12 h-48 w-48 rounded-full bg-gradient-to-br ${ind.accent} blur-3xl transition-opacity group-hover:opacity-100`}
        />

        {/* Photo industrie (Unsplash hotlink). Parallaxe y au scroll + zoom hover.
            L'image est sur-échelle (1.08) pour couvrir le débattement ±12px. */}
        <div className="relative -mx-7 -mt-7 mb-5 aspect-[16/10] overflow-hidden rounded-t-[2rem]">
          <motion.div
            style={{ y: reduce ? 0 : parallaxY }}
            className="absolute inset-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ind.image}
              alt={ind.imageAlt}
              loading="lazy"
              decoding="async"
              className="h-full w-full scale-[1.08] object-cover saturate-[0.95] transition-all duration-700 group-hover:scale-[1.13] group-hover:saturate-110"
            />
          </motion.div>
          {/* Voile bas pour fondre vers la carte glass */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-white/85 via-white/10 to-transparent"
          />
          {/* Icône posée en bas (côté début), par-dessus la photo */}
          <div
            className={`absolute bottom-3 start-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${ind.iconBg} text-white shadow-lg ring-2 ring-white/70 transition-transform group-hover:rotate-3 group-hover:scale-110`}
          >
            {ind.icon}
          </div>
        </div>

        <div className="relative flex grow flex-col">
          <h3 className="font-display text-2xl tracking-tight text-[#18181b]">
            {t(`${ind.key}.title`)}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#475569]">
            {t(`${ind.key}.desc`)}
          </p>

          {/* Mini-stats count-up — proof points par industrie */}
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-gradient-to-br from-[#ecfeff]/60 to-white/40 p-3 ring-1 ring-inset ring-[#22d3ee]/15">
            <CountUpStat
              value={stats.rdv}
              suffix="%"
              prefix="+"
              label={t.has(`${ind.key}.statRdv`) ? t(`${ind.key}.statRdv`) : "RDV pris"}
            />
            <CountUpStat
              value={stats.manques}
              suffix="%"
              prefix="−"
              label={t.has(`${ind.key}.statManques`) ? t(`${ind.key}.statManques`) : "appels manqués"}
              tone="cyan"
            />
          </div>

          {/* Checklist compacte en pills — une ligne par feature */}
          <ul className="mt-5 flex flex-wrap gap-2 border-t border-[#e2e8f0] pt-4">
            {(["f1", "f2", "f3"] as const).map((fk) => (
              <li
                key={fk}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfeff]/70 px-3 py-1 text-xs font-medium text-[#18181b] ring-1 ring-inset ring-[#22d3ee]/25"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-[#0e7490]"
                >
                  <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t(`${ind.key}.${fk}`)}
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}

function CountUpStat({
  value,
  suffix = "",
  prefix = "",
  label,
  tone = "primary",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
  tone?: "primary" | "cyan";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      motionVal.set(value);
      return;
    }
    const controls = animate(motionVal, value, {
      duration: 1.2,
      ease: EASE,
    });
    return controls.stop;
  }, [inView, motionVal, value, reduce]);

  return (
    <div ref={ref} className="min-w-0">
      <div className="flex items-baseline gap-0.5">
        <span className="text-[11px] font-bold text-[#475569]">{prefix}</span>
        <motion.span
          className={`font-display text-2xl font-bold tabular-nums ${
            tone === "cyan" ? "text-[#0e7490]" : "text-[#be185d]"
          }`}
        >
          {rounded}
        </motion.span>
        <span
          className={`text-sm font-bold ${
            tone === "cyan" ? "text-[#0e7490]" : "text-[#be185d]"
          }`}
        >
          {suffix}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#475569]">
        {label}
      </p>
    </div>
  );
}
