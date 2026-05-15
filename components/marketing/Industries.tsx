"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

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
      "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Salon de coiffure / beauté",
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
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#18181b] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base text-[#475569] sm:text-lg">
            {t("subtitle")}
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {INDUSTRIES.map((ind, i) => (
            <IndustryCard
              key={ind.key}
              ind={ind}
              t={t}
              stats={INDUSTRY_STATS[ind.key]}
              delay={i * 0.1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function IndustryCard({
  ind,
  t,
  stats,
  delay,
}: {
  ind: (typeof INDUSTRIES)[number];
  t: ReturnType<typeof useTranslations<"Industries">>;
  stats: { rdv: number; manques: number };
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6 }}
      className="group relative overflow-hidden rounded-[2rem] border border-white/50 bg-white/65 p-7 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.15)] backdrop-blur-xl transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_16px_48px_-16px_rgba(34,211,238,0.25)]"
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -end-12 -top-12 h-48 w-48 rounded-full bg-gradient-to-br ${ind.accent} blur-3xl transition-opacity group-hover:opacity-100`}
      />

      {/* Photo industrie (Unsplash hotlink). Ratio 16/10, zoom + saturation on hover. */}
      <div className="relative -mx-7 -mt-7 mb-5 aspect-[16/10] overflow-hidden rounded-t-[2rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ind.image}
          alt={ind.imageAlt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover saturate-[0.95] transition-all duration-700 group-hover:scale-[1.06] group-hover:saturate-110"
        />
        {/* Voile bas pour fondre vers la carte glass */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-white/85 via-white/10 to-transparent"
        />
        {/* Icône posée en bas-gauche, par-dessus la photo */}
        <div
          className={`absolute bottom-3 left-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${ind.iconBg} text-white shadow-lg ring-2 ring-white/70 transition-transform group-hover:rotate-3 group-hover:scale-110`}
        >
          {ind.icon}
        </div>
      </div>

      <div className="relative">
        <h3 className="font-display text-2xl tracking-tight text-[#18181b]">
          {t(`${ind.key}.title`)}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#475569]">
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

        <ul className="mt-5 space-y-2 border-t border-[#e2e8f0] pt-4">
          {(["f1", "f2", "f3"] as const).map((fk) => (
            <li
              key={fk}
              className="flex items-center gap-2 text-sm text-[#18181b]"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-[#0e7490]">
                <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t(`${ind.key}.${fk}`)}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
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
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v));

  useEffect(() => {
    if (!inView) return;
    const controls = animate(motionVal, value, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [inView, motionVal, value]);

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
