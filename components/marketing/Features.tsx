"use client";

import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Mini interactive components (one per tile)                                */
/* -------------------------------------------------------------------------- */

/** Bilingual hero — rotates greetings FR / EN / HE every 2s */
function LanguageSwitcher({ reduce }: { reduce: boolean }) {
  const greetings = [
    { text: "Bonjour", flag: "🇫🇷", dir: "ltr" as const },
    { text: "Hello", flag: "🇬🇧", dir: "ltr" as const },
    { text: "שלום", flag: "🇮🇱", dir: "rtl" as const },
  ];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % greetings.length), 2000);
    return () => clearInterval(id);
  }, [reduce, greetings.length]);

  const current = greetings[idx]!;

  return (
    <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fdf2f8] to-[#fce7f3] ring-1 ring-[#be185d]/10">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(8px)" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          dir={current.dir}
          className="flex items-center gap-3"
        >
          <span className="text-3xl drop-shadow-sm">{current.flag}</span>
          <span className="font-display text-3xl tracking-tight text-[#be185d] sm:text-4xl">
            {current.text}
          </span>
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
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

/** Latency — counts up 100→300ms with bar fill */
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
          className="h-full rounded-full bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_12px_rgba(34,211,238,0.6)]"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

/** Calendar — 7×3 grid of slots filling progressively, 10:30 highlighted */
function CalendarMock({ reduce }: { reduce: boolean }) {
  const cells = Array.from({ length: 21 });
  const [filled, setFilled] = useState<number[]>(reduce ? [...cells.keys()] : []);
  const [highlight, setHighlight] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    setFilled([]);
    setHighlight(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    cells.forEach((_, i) => {
      timers.push(
        setTimeout(() => {
          setFilled((prev) => [...prev, i]);
        }, 120 + i * 80),
      );
    });
    timers.push(setTimeout(() => setHighlight(true), 120 + cells.length * 80 + 300));
    // Loop
    const loop = setInterval(() => {
      setFilled([]);
      setHighlight(false);
      cells.forEach((_, i) => {
        timers.push(
          setTimeout(() => setFilled((prev) => [...prev, i]), 120 + i * 80),
        );
      });
      timers.push(
        setTimeout(() => setHighlight(true), 120 + cells.length * 80 + 300),
      );
    }, cells.length * 80 + 2200);
    return () => {
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [reduce, cells.length]);

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

/** CRM — avatar + typing name + phone char-by-char */
function ContactCard({ reduce }: { reduce: boolean }) {
  const name = "Sarah Cohen";
  const phone = "+972 54 871 2208";
  const [nLen, setNLen] = useState(reduce ? name.length : 0);
  const [pLen, setPLen] = useState(reduce ? phone.length : 0);

  useEffect(() => {
    if (reduce) return;
    let n = 0;
    let p = 0;
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
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f472b6] to-[#be185d] font-bold text-white shadow-md">
        SC
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#18181b]">
          {name.slice(0, nLen)}
          <span className="inline-block w-[1px] animate-pulse bg-[#be185d]">&nbsp;</span>
        </p>
        <p className="truncate text-[11px] tabular-nums text-[#475569]">
          {phone.slice(0, pLen)}
        </p>
      </div>
    </div>
  );
}

/** Reschedule — 2 cards swap their position via layout */
function SwapAnimation({ reduce }: { reduce: boolean }) {
  const [order, setOrder] = useState<[number, number]>([0, 1]);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setOrder(([a, b]) => [b, a]);
    }, 2400);
    return () => clearInterval(id);
  }, [reduce]);

  const slots = [
    { id: 0, time: "10:30", color: "from-[#22d3ee] to-[#0e7490]" },
    { id: 1, time: "14:00", color: "from-[#be185d] to-[#db2777]" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {order.map((id, i) => {
        const slot = slots.find((s) => s.id === id)!;
        return (
          <motion.div
            key={slot.id}
            layout
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            className={`flex items-center justify-between rounded-lg bg-gradient-to-r ${slot.color} px-3 py-2 text-white shadow-sm`}
          >
            <span className="text-xs font-bold tabular-nums">{slot.time}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-80">
              {i === 0 ? "→" : "↩"}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Anti-silence — 8 bar mini waveform pulsing */
function MicWave({ reduce }: { reduce: boolean }) {
  return (
    <div className="flex h-12 items-center justify-center gap-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.span
          key={i}
          className="block w-1 rounded-full bg-gradient-to-t from-[#0e7490] to-[#22d3ee] [filter:drop-shadow(0_0_6px_rgba(34,211,238,0.6))]"
          initial={{ height: 6 }}
          animate={
            reduce
              ? { height: 12 }
              : { height: [6, 24, 10, 28, 8, 18, 6] }
          }
          transition={
            reduce
              ? undefined
              : {
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.08,
                }
          }
        />
      ))}
    </div>
  );
}

/** Voice premium — 16-bar wave + rotating persona avatars */
function VoiceWaveform({ reduce }: { reduce: boolean }) {
  const personas = ["M", "S", "V"];
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setActive((i) => (i + 1) % personas.length), 1600);
    return () => clearInterval(id);
  }, [reduce, personas.length]);

  return (
    <div className="flex h-full items-center gap-4">
      <div className="flex items-end gap-[3px]">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.span
            key={i}
            className="block w-[3px] rounded-full bg-gradient-to-t from-[#0e7490] via-[#22d3ee] to-[#67e8f9]"
            initial={{ height: 8 }}
            animate={
              reduce
                ? { height: 16 }
                : {
                    height: [
                      8 + ((i * 3) % 10),
                      28 - ((i * 5) % 18),
                      14,
                      32 - ((i * 7) % 22),
                      10,
                    ],
                  }
            }
            transition={
              reduce
                ? undefined
                : {
                    duration: 1.8,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.05,
                  }
            }
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        {personas.map((p, i) => (
          <motion.div
            key={p}
            animate={{
              scale: active === i ? 1.15 : 0.92,
              opacity: active === i ? 1 : 0.45,
            }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-2 ${
              active === i
                ? "bg-gradient-to-br from-[#22d3ee] to-[#0e7490] text-white shadow-[0_0_14px_rgba(34,211,238,0.6)] ring-white"
                : "bg-white/70 text-[#0e7490] ring-[#0e7490]/15"
            }`}
          >
            {p}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Config — 3 mini sliders moving on their own */
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
          <div className="relative h-1.5 flex-1 rounded-full bg-[#22d3ee]/15">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#22d3ee] to-[#0e7490]"
              animate={{ width: `${vals[i]}%` }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(34,211,238,0.5)] ring-2 ring-[#22d3ee]"
              animate={{ left: `calc(${vals[i]}% - 7px)` }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tile shell                                                                */
/* -------------------------------------------------------------------------- */

type TileProps = {
  className?: string;
  delay?: number;
  title: string;
  desc: string;
  accent?: "magenta" | "cyan" | "coral" | "teal";
  children: React.ReactNode;
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
  const styles = ACCENT_STYLES[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{
        duration: 0.7,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ scale: 1.02, y: -4 }}
      className={`group relative flex flex-col overflow-hidden rounded-[1.5rem] border border-white/40 bg-white/65 p-6 shadow-[0_8px_28px_-14px_rgba(190,24,93,0.15)] backdrop-blur-xl transition-shadow ${styles.glow} ${className}`}
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
  );
}

/* -------------------------------------------------------------------------- */
/*  Section                                                                   */
/* -------------------------------------------------------------------------- */

export function Features() {
  const t = useTranslations("Features");
  const reduce = useReducedMotion() ?? false;

  return (
    <section id="features" className="relative py-24 sm:py-32">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-8%] top-1/3 h-96 w-96 rounded-full bg-[#22d3ee]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-6%] top-2/3 h-80 w-80 rounded-full bg-[#f472b6]/10 blur-3xl"
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
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[#be185d] sm:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
        </motion.div>

        {/* Bento grid — 6 cols × 4 rows on desktop, stacked on mobile */}
        <div className="mt-14 grid auto-rows-[200px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* 1. Bilingual — 2×2 hero */}
          <Tile
            className="lg:col-span-2 lg:row-span-2"
            delay={0.0}
            accent="magenta"
            title={t("list.bilingual.title")}
            desc={t("list.bilingual.desc")}
          >
            <LanguageSwitcher reduce={reduce} />
          </Tile>

          {/* 2. Latency — 1×1 (becomes 2-cols wide on lg) */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.08}
            accent="cyan"
            title={t("list.latency.title")}
            desc={t("list.latency.desc")}
          >
            <SpeedMeter reduce={reduce} />
          </Tile>

          {/* 3. Calendar — 2×2 */}
          <Tile
            className="lg:col-span-2 lg:row-span-2"
            delay={0.16}
            accent="cyan"
            title={t("list.calendar.title")}
            desc={t("list.calendar.desc")}
          >
            <CalendarMock reduce={reduce} />
          </Tile>

          {/* 4. CRM — 1×1 (2 cols wide) */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.24}
            accent="coral"
            title={t("list.crm.title")}
            desc={t("list.crm.desc")}
          >
            <ContactCard reduce={reduce} />
          </Tile>

          {/* 5. Reschedule — 1×1 (2 cols wide) */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.32}
            accent="magenta"
            title={t("list.reschedule.title")}
            desc={t("list.reschedule.desc")}
          >
            <SwapAnimation reduce={reduce} />
          </Tile>

          {/* 6. Anti-silence — 1×1 (2 cols wide) */}
          <Tile
            className="lg:col-span-2 lg:row-span-1"
            delay={0.40}
            accent="teal"
            title={t("list.antiSilence.title")}
            desc={t("list.antiSilence.desc")}
          >
            <MicWave reduce={reduce} />
          </Tile>

          {/* 7. Voice premium — 2×1 (3 cols wide on lg) */}
          <Tile
            className="lg:col-span-3 lg:row-span-1"
            delay={0.48}
            accent="teal"
            title={t("list.voice.title")}
            desc={t("list.voice.desc")}
          >
            <VoiceWaveform reduce={reduce} />
          </Tile>

          {/* 8. Config live — 2×1 (3 cols wide on lg) */}
          <Tile
            className="lg:col-span-3 lg:row-span-1"
            delay={0.56}
            accent="cyan"
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
