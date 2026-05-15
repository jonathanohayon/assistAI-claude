"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

/* -------------------------------------------------------------------------- */
/*  Static structural data (numbers / colors — not translatable)              */
/* -------------------------------------------------------------------------- */

type FeatureKey = "voices" | "sliders" | "multilingual" | "liveTest";
type SliderKey = "warmth" | "formality" | "energy" | "speed";

const FEATURE_KEYS: ReadonlyArray<FeatureKey> = [
  "voices",
  "sliders",
  "multilingual",
  "liveTest",
];

const SLIDERS: ReadonlyArray<{
  key: SliderKey;
  value: number;
  color: string;
  track: string;
}> = [
  { key: "warmth", value: 70, color: "#BE185D", track: "#FBCFE8" },
  { key: "formality", value: 35, color: "#22D3EE", track: "#CFFAFE" },
  { key: "energy", value: 60, color: "#FB7185", track: "#FFE4E6" },
  { key: "speed", value: 50, color: "#0E7490", track: "#CFFAFE" },
];

const LANGUAGES: ReadonlyArray<{ code: string; selected: boolean }> = [
  { code: "FR", selected: true },
  { code: "HE", selected: false },
  { code: "EN", selected: false },
];

/* -------------------------------------------------------------------------- */
/*  Inline icons                                                              */
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

function SparkleIcon({ className }: { className?: string }) {
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
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main section                                                              */
/* -------------------------------------------------------------------------- */

export function VoiceConfigShowcase() {
  const reduce = useReducedMotion() ?? false;
  const t = useTranslations("VoiceStudio");

  return (
    <section
      id="voice-studio"
      className="relative overflow-hidden py-24 sm:py-32"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-24 h-[28rem] w-[28rem] rounded-full bg-[#22D3EE]/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-[32rem] w-[32rem] rounded-full bg-[#BE185D]/20 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#0E7490]">
            <SparkleIcon className="h-3.5 w-3.5" />
            {t("eyebrow")}
          </span>
          <h2 className="mt-6 font-display text-4xl tracking-tight text-[#18181B] sm:text-5xl">
            {t("title")}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[#475569]">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* 2-column grid */}
        <div className="mt-16 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* LEFT — feature bullets */}
          <motion.ul
            initial={reduce ? false : { opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="space-y-7"
          >
            {FEATURE_KEYS.map((key, i) => (
              <motion.li
                key={key}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.5,
                  delay: 0.15 + i * 0.08,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="flex gap-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#BE185D] to-[#DB2777] text-white shadow-lg shadow-[#BE185D]/30">
                  <CheckIcon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-lg tracking-tight text-[#18181B]">
                    {t(`features.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#475569]">
                    {t(`features.${key}.desc`)}
                  </p>
                </div>
              </motion.li>
            ))}
          </motion.ul>

          {/* RIGHT — Voice Studio mock panel */}
          <div className="relative">
            {/* Halo glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 rounded-[2.5rem] bg-[#22D3EE]/30 blur-3xl"
            />

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            >
              <motion.div
                animate={reduce ? undefined : { y: [0, -8, 0] }}
                transition={
                  reduce
                    ? undefined
                    : {
                        duration: 4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }
                }
                className="relative rounded-3xl border border-white/50 bg-white/90 p-5 shadow-2xl shadow-[#BE185D]/10 backdrop-blur-2xl sm:p-6"
              >
                {/* Faux window chrome */}
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FB7185]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[#94A3B8]">
                    dashboard / voice
                  </span>
                </div>

                {/* Voice tile */}
                <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#475569]">
                      <MicIcon className="h-4 w-4 text-[#0E7490]" />
                      {t("panel.agentVoice")}
                    </span>
                    <span className="font-mono text-[10px] text-[#94A3B8]">
                      gpt-realtime-mini
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {/* Dropdown */}
                    <button
                      type="button"
                      className="group flex flex-1 items-center justify-between rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3 py-2.5 text-left transition hover:border-[#BE185D]/30"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                          F
                        </span>
                        <span className="text-sm font-semibold text-[#18181B]">
                          Coral
                        </span>
                        <span className="text-xs text-[#94A3B8]">·</span>
                        <span className="text-xs text-[#475569]">
                          {t("panel.voiceGenderF")}
                        </span>
                        <span className="text-xs text-[#94A3B8]">·</span>
                        <span className="text-xs text-[#475569]">FR</span>
                      </span>
                      <ChevronDownIcon className="h-4 w-4 text-[#94A3B8] transition group-hover:text-[#BE185D]" />
                    </button>

                    {/* Play / preview */}
                    <motion.button
                      type="button"
                      whileTap={reduce ? undefined : { scale: 0.92 }}
                      whileHover={reduce ? undefined : { scale: 1.05 }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#22D3EE] to-[#0E7490] text-white shadow-lg shadow-[#22D3EE]/30"
                      aria-label={t("panel.previewVoiceAria")}
                    >
                      <PlayIcon className="ml-0.5 h-4 w-4" />
                    </motion.button>
                  </div>
                </div>

                {/* Persona tile */}
                <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-base tracking-tight text-[#18181B]">
                      {t("panel.personality")}
                    </h4>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#BE185D]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#BE185D]">
                      {t("panel.liveBadge")}
                    </span>
                  </div>

                  {/* Sliders */}
                  <div className="mt-4 space-y-3.5">
                    {SLIDERS.map((slider, i) => (
                      <div key={slider.key}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-[#475569]">
                            {t(`sliders.${slider.key}`)}
                          </span>
                          <span
                            className="font-mono text-[10px] font-semibold"
                            style={{ color: slider.color }}
                          >
                            {slider.value}%
                          </span>
                        </div>
                        <div
                          className="relative h-2 w-full overflow-hidden rounded-full"
                          style={{ backgroundColor: slider.track }}
                        >
                          <motion.div
                            initial={reduce ? false : { width: 0 }}
                            whileInView={{ width: `${slider.value}%` }}
                            viewport={{ once: true, margin: "-40px" }}
                            transition={{
                              duration: 0.9,
                              delay: 0.4 + i * 0.1,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ backgroundColor: slider.color }}
                          />
                          <motion.span
                            initial={reduce ? false : { left: 0, opacity: 0 }}
                            whileInView={{
                              left: `calc(${slider.value}% - 8px)`,
                              opacity: 1,
                            }}
                            viewport={{ once: true, margin: "-40px" }}
                            transition={{
                              duration: 0.9,
                              delay: 0.4 + i * 0.1,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 bg-white shadow-md"
                            style={{ borderColor: slider.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Language pills */}
                  <div className="mt-5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                      {t("panel.primaryLanguage")}
                    </span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {LANGUAGES.map((lang) => (
                        <span
                          key={lang.code}
                          className={
                            lang.selected
                              ? "inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#BE185D] to-[#DB2777] px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-[#BE185D]/30"
                              : "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#475569] ring-1 ring-slate-200"
                          }
                        >
                          {lang.selected && (
                            <CheckIcon className="h-3 w-3" />
                          )}
                          {lang.code}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Agent name input */}
                  <div className="mt-5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                      {t("panel.agentName")}
                    </label>
                    <div className="mt-1.5 flex items-center rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3 py-2.5">
                      <span className="font-display text-sm text-[#18181B]">
                        Tamara
                      </span>
                      <motion.span
                        animate={reduce ? undefined : { opacity: [1, 0, 1] }}
                        transition={
                          reduce
                            ? undefined
                            : {
                                duration: 1.2,
                                repeat: Infinity,
                                ease: "linear",
                              }
                        }
                        className="ml-0.5 inline-block h-4 w-px bg-[#BE185D]"
                        aria-hidden
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
