"use client";

import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Reveal, EASE } from "./Reveal";

/* -------------------------------------------------------------------------- */
/*  Inline icons (SVG, stroke 1.5–2 — jamais d'emoji)                          */
/* -------------------------------------------------------------------------- */

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.5v13a1 1 0 0 0 1.55.83l10-6.5a1 1 0 0 0 0-1.66l-10-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile A — bilingue : rotation des salutations FR / EN / HE                 */
/* -------------------------------------------------------------------------- */

function LanguageSwitcher({ reduce }: { reduce: boolean }) {
  const greetings = [
    { text: "Bonjour", code: "FR", dir: "ltr" as const },
    { text: "Hello", code: "EN", dir: "ltr" as const },
    { text: "שלום", code: "HE", dir: "rtl" as const },
  ];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % greetings.length), 2000);
    return () => clearInterval(id);
  }, [reduce, greetings.length]);

  const current = greetings[idx]!;

  return (
    <div className="relative flex h-full min-h-32 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fdf2f8] to-[#fce7f3] ring-1 ring-[#be185d]/10">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={
            reduce
              ? { opacity: 0 }
              : { opacity: 0, y: 12, filter: "blur(8px)" }
          }
          animate={
            reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }
          }
          exit={
            reduce
              ? { opacity: 0 }
              : { opacity: 0, y: -12, filter: "blur(8px)" }
          }
          transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE }}
          dir={current.dir}
          className="flex items-center gap-3"
        >
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] text-[11px] font-bold uppercase tracking-wider text-white shadow-md shadow-[#be185d]/30"
          >
            {current.code}
          </span>
          <span className="font-display text-3xl tracking-tight text-[#be185d] sm:text-4xl">
            {current.text}
          </span>
        </motion.div>
      </AnimatePresence>
      <div
        aria-hidden
        className="absolute bottom-3 start-1/2 flex -translate-x-1/2 gap-1.5"
      >
        {greetings.map((_, i) => (
          <span
            key={i}
            className={`h-1 w-1 rounded-full transition-all ${
              i === idx ? "w-4 bg-[#be185d]" : "bg-[#be185d]/25"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile B — latence : compteur 100→300ms + barre (scaleX, RTL-safe)          */
/* -------------------------------------------------------------------------- */

function SpeedMeter({ reduce }: { reduce: boolean }) {
  const [ms, setMs] = useState(reduce ? 280 : 100);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t1 = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let dir = 1;
    let val = 100;
    const tick = () => {
      val += dir * 2.5;
      if (val >= 290) dir = -1;
      if (val <= 100) dir = 1;
      setMs(Math.round(val));
      raf = window.setTimeout(() => requestAnimationFrame(tick), 40) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
  }, [reduce]);

  const pct = Math.min(100, ((ms - 100) / 200) * 100);

  return (
    <div className="flex h-full flex-col justify-end">
      {loading ? (
        <div className="h-10 w-24 animate-pulse rounded-md bg-[#22d3ee]/15" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="font-display text-4xl font-extrabold tracking-tight text-[#0e7490] tabular-nums">
            {ms}
          </span>
          <span className="text-sm font-medium text-[#0e7490]/70">ms</span>
        </div>
      )}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#22d3ee]/15">
        <motion.div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_12px_rgba(34,211,238,0.6)] rtl:origin-right"
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile C — CRM : fiche contact qui se remplit caractère par caractère       */
/* -------------------------------------------------------------------------- */

function ContactCard({ reduce }: { reduce: boolean }) {
  const name = "Sarah Cohen";
  const phone = "+972 54 871 2208";
  const [nLen, setNLen] = useState(reduce ? name.length : 0);
  const [pLen, setPLen] = useState(reduce ? phone.length : 0);

  useEffect(() => {
    if (reduce) return;
    let n = 0;
    let p = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset de l'animation quand prefers-reduced-motion change, pattern voulu
    setNLen(0);
    setPLen(0);
    const nTimer = setInterval(() => {
      n += 1;
      setNLen(n);
      if (n >= name.length) clearInterval(nTimer);
    }, 90);
    const pTimer = setInterval(() => {
      if (n < name.length) return;
      p += 1;
      setPLen(p);
      if (p >= phone.length) clearInterval(pTimer);
    }, 60);
    const reset = setInterval(() => {
      n = 0;
      p = 0;
      setNLen(0);
      setPLen(0);
    }, 6000);
    return () => {
      clearInterval(nTimer);
      clearInterval(pTimer);
      clearInterval(reset);
    };
  }, [reduce, name.length, phone.length]);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-[#fff1f2] to-[#fce7f3] p-3 ring-1 ring-[#f472b6]/15">
      <div
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f472b6] to-[#be185d] font-bold text-white shadow-md"
      >
        SC
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#18181b]">
          {name.slice(0, nLen)}
          <span
            aria-hidden
            className="inline-block w-px animate-pulse bg-[#be185d]"
          >
            &nbsp;
          </span>
        </p>
        <p className="truncate text-[11px] tabular-nums text-[#475569]" dir="ltr">
          {phone.slice(0, pLen)}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile D — Voice Studio compact (la vedette du bento)                       */
/* -------------------------------------------------------------------------- */

const STUDIO_SLIDERS: ReadonlyArray<{
  key: "warmth" | "energy" | "speed";
  value: number;
  color: string;
  track: string;
}> = [
  { key: "warmth", value: 70, color: "#be185d", track: "#fbcfe8" },
  { key: "energy", value: 60, color: "#fb7185", track: "#ffe4e6" },
  { key: "speed", value: 50, color: "#0e7490", track: "#cffafe" },
];

const STUDIO_LANGUAGES: ReadonlyArray<{ code: string; selected: boolean }> = [
  { code: "FR", selected: true },
  { code: "HE", selected: false },
  { code: "EN", selected: false },
];

function VoiceStudioPanel({ reduce }: { reduce: boolean }) {
  const tv = useTranslations("VoiceStudio");

  return (
    <motion.div
      animate={reduce ? undefined : { y: [0, -6, 0] }}
      transition={
        reduce
          ? undefined
          : { duration: 4, repeat: Infinity, ease: "easeInOut" }
      }
      className="rounded-2xl border border-white/60 bg-white/90 p-3.5 shadow-xl shadow-[#be185d]/10 backdrop-blur-xl"
    >
      {/* Faux window chrome */}
      <div className="mb-3 flex items-center justify-between">
        <div aria-hidden className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#fb7185]" />
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#64748b]">
          dashboard / voice
        </span>
      </div>

      {/* Voice selector + play */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="group/voice flex flex-1 cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-2.5 py-1.5 text-start transition-colors hover:border-[#22d3ee]/50"
        >
          <span className="flex items-center gap-1.5">
            <MicIcon className="h-3.5 w-3.5 text-[#0e7490]" />
            <span className="text-xs font-semibold text-[#18181b]">Coral</span>
            <span aria-hidden className="text-[10px] text-[#64748b]">·</span>
            <span className="text-[10px] text-[#475569]">
              {tv("panel.voiceGenderF")}
            </span>
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 text-[#64748b] transition-colors group-hover/voice:text-[#0e7490]" />
        </button>
        <motion.button
          type="button"
          whileTap={reduce ? undefined : { scale: 0.92 }}
          whileHover={reduce ? undefined : { scale: 1.05 }}
          transition={{ type: "spring", stiffness: 280, damping: 22 }}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-gradient-to-br from-[#22d3ee] to-[#0e7490] text-white shadow-lg shadow-[#22d3ee]/30"
          aria-label={tv("panel.previewVoiceAria")}
        >
          <PlayIcon className="ms-0.5 h-3.5 w-3.5" />
        </motion.button>
      </div>

      {/* Personality sliders */}
      <div className="mt-3 space-y-2.5">
        {STUDIO_SLIDERS.map((slider, i) => (
          <div key={slider.key}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium text-[#475569]">
                {tv(`sliders.${slider.key}`)}
              </span>
              <span
                className="font-mono text-[9px] font-semibold tabular-nums"
                style={{ color: slider.color }}
              >
                {slider.value}%
              </span>
            </div>
            <div
              className="relative h-1.5 w-full rounded-full"
              style={{ backgroundColor: slider.track }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <motion.div
                  initial={reduce ? false : { scaleX: 0 }}
                  whileInView={{ scaleX: slider.value / 100 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{
                    duration: 0.9,
                    delay: 0.35 + i * 0.12,
                    ease: EASE,
                  }}
                  className="h-full w-full origin-left rounded-full rtl:origin-right"
                  style={{ backgroundColor: slider.color }}
                />
              </div>
              <motion.span
                initial={reduce ? false : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: 0.9 + i * 0.12 }}
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-white shadow-md"
                style={{
                  borderColor: slider.color,
                  insetInlineStart: `calc(${slider.value}% - 6px)`,
                }}
                aria-hidden
              />
            </div>
          </div>
        ))}
      </div>

      {/* Language pills */}
      <div className="mt-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[#64748b]">
          {tv("panel.primaryLanguage")}
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {STUDIO_LANGUAGES.map((lang) => (
            <span
              key={lang.code}
              className={
                lang.selected
                  ? "inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#be185d] to-[#db2777] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md shadow-[#be185d]/30"
                  : "inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#475569] ring-1 ring-slate-200"
              }
            >
              {lang.selected && <CheckIcon className="h-2.5 w-2.5" />}
              {lang.code}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile E — calendrier : 7×3 slots qui se remplissent en stagger             */
/* -------------------------------------------------------------------------- */

const CALENDAR_CELL_COUNT = 21;

function CalendarMock({ reduce }: { reduce: boolean }) {
  // Uniquement pour les keys de rendu — la logique d'anim utilise la constante.
  const cells = Array.from({ length: CALENDAR_CELL_COUNT });
  const [filled, setFilled] = useState<number[]>(reduce ? [...cells.keys()] : []);
  const [highlight, setHighlight] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset de l'animation quand prefers-reduced-motion change, pattern voulu
    setFilled([]);
    setHighlight(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < CALENDAR_CELL_COUNT; i++) {
      timers.push(
        setTimeout(() => {
          setFilled((prev) => [...prev, i]);
        }, 120 + i * 80),
      );
    }
    timers.push(
      setTimeout(() => setHighlight(true), 120 + CALENDAR_CELL_COUNT * 80 + 300),
    );
    // Loop
    const loop = setInterval(() => {
      setFilled([]);
      setHighlight(false);
      for (let i = 0; i < CALENDAR_CELL_COUNT; i++) {
        timers.push(
          setTimeout(() => setFilled((prev) => [...prev, i]), 120 + i * 80),
        );
      }
      timers.push(
        setTimeout(() => setHighlight(true), 120 + CALENDAR_CELL_COUNT * 80 + 300),
      );
    }, CALENDAR_CELL_COUNT * 80 + 2200);
    return () => {
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [reduce]);

  const highlightIdx = 8; // arbitrary slot we badge "10:30"

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {cells.map((_, i) => {
        const isFilled = filled.includes(i);
        const isHi = highlight && i === highlightIdx;
        return (
          <motion.div
            key={i}
            initial={false}
            animate={{
              scale: isFilled ? 1 : 0.7,
              opacity: isFilled ? 1 : 0.25,
            }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className={`relative aspect-square rounded-md ${
              isHi
                ? "bg-gradient-to-br from-[#be185d] to-[#db2777] shadow-[0_4px_14px_-2px_rgba(190,24,93,0.5)]"
                : isFilled
                  ? "bg-[#22d3ee]/30"
                  : "bg-[#22d3ee]/8"
            }`}
          >
            {isHi && (
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white"
              >
                10:30
              </motion.span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tuile F — config live : 3 mini sliders qui bougent seuls (scaleX)          */
/* -------------------------------------------------------------------------- */

function SliderDemo({ reduce }: { reduce: boolean }) {
  const labels = ["Tone", "Speed", "Warmth"];
  const [vals, setVals] = useState<number[]>([35, 70, 55]);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setVals((prev) =>
        prev.map((v) => {
          const delta = (Math.random() - 0.5) * 30;
          return Math.max(10, Math.min(90, v + delta));
        }),
      );
    }, 1600);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {labels.map((lbl, i) => (
        <div key={lbl} className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#0e7490]/70">
            {lbl}
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#22d3ee]/15">
            <motion.div
              className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_10px_rgba(34,211,238,0.45)] rtl:origin-right"
              animate={{ scaleX: (vals[i] ?? 50) / 100 }}
              transition={{ duration: 1.2, ease: EASE }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tile shell — Reveal (primitive partagée) + hover spring + border cyan      */
/* -------------------------------------------------------------------------- */

type TileProps = {
  className?: string;
  delay?: number;
  title: string;
  desc: string;
  accent?: "magenta" | "cyan" | "coral" | "teal";
  children: ReactNode;
};

const ACCENT_STYLES: Record<
  NonNullable<TileProps["accent"]>,
  { title: string; glow: string }
> = {
  magenta: {
    title: "text-[#be185d]",
    glow: "hover:shadow-[0_24px_60px_-20px_rgba(190,24,93,0.30)]",
  },
  cyan: {
    title: "text-[#0e7490]",
    glow: "hover:shadow-[0_24px_60px_-20px_rgba(34,211,238,0.30)]",
  },
  coral: {
    title: "text-[#be185d]",
    glow: "hover:shadow-[0_24px_60px_-20px_rgba(244,114,182,0.30)]",
  },
  teal: {
    title: "text-[#0e7490]",
    glow: "hover:shadow-[0_24px_60px_-20px_rgba(14,116,144,0.30)]",
  },
};

function Tile({
  className = "",
  delay = 0,
  title,
  desc,
  accent = "magenta",
  children,
}: TileProps) {
  const reduce = useReducedMotion() ?? false;
  const styles = ACCENT_STYLES[accent];

  return (
    <Reveal delay={delay} className={`h-full ${className}`}>
      <motion.div
        whileHover={reduce ? undefined : { scale: 1.02, y: -4 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className={`group relative flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-white/40 bg-white/65 p-6 shadow-[0_8px_28px_-14px_rgba(190,24,93,0.15)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 hover:border-[#22d3ee]/60 ${styles.glow}`}
      >
        <div className="relative flex-1">{children}</div>
        <div className="relative mt-5">
          <h3
            className={`font-display text-lg font-bold tracking-tight ${styles.title}`}
          >
            {title}
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#475569]">
            {desc}
          </p>
        </div>
      </motion.div>
    </Reveal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section — bento fusionné Features × Voice Studio (6 tuiles)                */
/* -------------------------------------------------------------------------- */

export function FeatureBento() {
  const t = useTranslations("Features");
  const reduce = useReducedMotion() ?? false;

  return (
    <section id="features" className="relative py-24 sm:py-32">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute start-[-8%] top-1/3 h-96 w-96 rounded-full bg-[#22d3ee]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute end-[-6%] top-2/3 h-80 w-80 rounded-full bg-[#f472b6]/10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#be185d] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
        </Reveal>

        {/*
          Bento — 6 cols × 3 rows sur lg, placement auto sans trou :
          r1-2: A(c1-2) · r1: B(c3-4) C(c5-6) · r2-3: D(c3-4) E(c5-6) · r3: F(c1-2)
        */}
        <div className="mt-14 grid auto-rows-[minmax(200px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:auto-rows-[200px] lg:grid-cols-6">
          {/* A. Trilingue — 2×2 */}
          <Tile
            className="lg:col-span-2 lg:row-span-2"
            delay={0}
            accent="magenta"
            title={t("list.bilingual.title")}
            desc={t("list.bilingual.desc")}
          >
            <LanguageSwitcher reduce={reduce} />
          </Tile>

          {/* B. Latence — 2×1 */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.06}
            accent="cyan"
            title={t("list.latency.title")}
            desc={t("list.latency.desc")}
          >
            <SpeedMeter reduce={reduce} />
          </Tile>

          {/* C. CRM — 2×1 */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.12}
            accent="coral"
            title={t("list.crm.title")}
            desc={t("list.crm.desc")}
          >
            <ContactCard reduce={reduce} />
          </Tile>

          {/* D. Voice Studio — 2×2, la vedette */}
          <Tile
            className="lg:col-span-2 lg:row-span-2"
            delay={0.18}
            accent="teal"
            title={t("list.voice.title")}
            desc={t("list.voice.desc")}
          >
            <VoiceStudioPanel reduce={reduce} />
          </Tile>

          {/* E. Calendrier — 2×2 */}
          <Tile
            className="lg:col-span-2 lg:row-span-2"
            delay={0.24}
            accent="cyan"
            title={t("list.calendar.title")}
            desc={t("list.calendar.desc")}
          >
            <CalendarMock reduce={reduce} />
          </Tile>

          {/* F. Config live — 2×1 */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.3}
            accent="teal"
            title={t("list.config.title")}
            desc={t("list.config.desc")}
          >
            <SliderDemo reduce={reduce} />
          </Tile>
        </div>
      </div>
    </section>
  );
}
