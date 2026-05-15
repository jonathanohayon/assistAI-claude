"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { LiveTestPanelLK } from "@/components/LiveTestPanelLK";
import { PERSONALITY_KEYS } from "@/lib/personality";
import {
  useRealtimeCatalog,
  voicesForCatalog,
} from "@/lib/use-realtime-catalog";

// ─── Types ──────────────────────────────────────────────────────────────

type Personality = Partial<Record<(typeof PERSONALITY_KEYS)[number], number>>;

type FormState = {
  instructions: string;
  greetingInstructions: string;
  model: string;
  voice: string;
  temperature: number;
  speed: number;
  maxResponseTokens: number;
  ownerWhatsapp: string;
  primaryLanguage: string;
  inheritAdminGlobals: boolean;
  personality: Personality;
  agentName: string;
  /** Slider 1-10 piloté ici, envoyé tel quel au PUT puis exposé à
   *  /api/agent/config pour le worker qui le mappe en enhancementLevel 0.1-1.0
   *  du QVF 2.1 L (ai-coustics). 1 = passthrough, 8 = équilibré, 10 = agressif. */
  noiseReductionLevel: number;
};

type Gender = "f" | "m";

// ─── Constants ──────────────────────────────────────────────────────────

// Genre par défaut pour chaque voix OpenAI Realtime — utilisé pour colorer
// la card (rose = féminine, cyan = masculine). Liste alignée avec
// PROVIDERS.openai.voices dans lib/realtime.ts.
const VOICE_GENDER: Record<string, Gender> = {
  marin: "f",
  ballad: "m",
  sage: "f",
  verse: "m",
  alloy: "m",
  shimmer: "f",
  echo: "m",
  fable: "m",
  onyx: "m",
  nova: "f",
  coral: "f",
  ash: "m",
};

// Voice IDs — descriptions traduites construites dynamiquement via t() côté
// composant (voir useMemo `voiceDescMap` plus bas).
const VOICE_IDS = [
  "marin", "ballad", "sage", "verse", "alloy", "shimmer",
  "echo", "fable", "onyx", "nova", "coral", "ash",
] as const;

// 9 dimensions de personnalité — 3 branchées E2E (vitesse → speed,
// creativite → temperature, reactivite → VAD silence_duration_ms côté
// /api/session), 6 autres en preview UI seulement (DB persisté mais agent
// vocal ne les consomme pas encore).
//
// Module-level : SEULEMENT les icons/anim/enabled/badge. Les labels sont
// construits dynamiquement via t() dans le composant (voir `sliderDefs`).
const PERSONALITY_SLIDER_META = [
  { key: "vitesse", anim: "anim-slide-x", enabled: true, badge: "OpenAI", icon: (
    <>
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </>
  ) },
  { key: "creativite", anim: "anim-sparkle", enabled: true, badge: "OpenAI", icon: (
    <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
  ) },
  { key: "reactivite", anim: "anim-pulse-quick", enabled: true, badge: "VAD", icon: (
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  ) },
  { key: "joie", anim: "anim-bounce-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "empathie", anim: "anim-pulse-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ) },
  { key: "dynamisme", anim: "anim-flash", enabled: false, badge: undefined as string | undefined, icon: (
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  ) },
  { key: "professionnel", anim: "anim-tilt", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ) },
  { key: "humour", anim: "anim-wiggle", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M7 13a5 5 0 0 0 10 0" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "accent", anim: "anim-spin-slow", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ) },
] as const;

// Capitalize first letter for i18n key construction (key "vitesse" → "Vitesse").
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const PERSONALITY_DEFAULT: Personality = {
  vitesse: 5,
  creativite: 5,
  reactivite: 5,
  joie: 6,
  empathie: 8,
  dynamisme: 7,
  professionnel: 7,
  humour: 4,
  accent: 3,
};

// Mappings entre l'échelle UI 1-10 et les valeurs API OpenAI réelles.
// Speed : 0.5x → 1.5x sur l'API, 1 → 10 côté UI (5 = 1.0x baseline).
// Temperature : 0 → 1.5 sur l'API, 1 → 10 côté UI.
// Réactivité : la valeur 1-10 est passée telle quelle à /api/session
// qui calcule silence_duration_ms (1200ms → 200ms).
const speedFromUI = (ui: number) => 0.5 + ((ui - 1) / 9) * 1.0; // 0.5..1.5
const uiFromSpeed = (api: number) => Math.round(((api - 0.5) / 1.0) * 9 + 1);
const tempFromUI = (ui: number) => ((ui - 1) / 9) * 1.5; // 0..1.5
const uiFromTemp = (api: number) => Math.round((api / 1.5) * 9 + 1);

const clamp10 = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

// ─── Component ──────────────────────────────────────────────────────────

type DashboardStats = {
  callsToday: number;
  conversion: number;
  avgDuration: string;
  rdv: number;
  minutesThisMonth: number;
};

export function ConfigForm({
  initial,
  isAdmin = false,
  adminInheritablePreview = "",
  planLabel = "",
  primaryPhone = null,
  lastUpdatedLabel = "",
  stats,
}: {
  initial: FormState;
  isAdmin?: boolean;
  adminInheritablePreview?: string;
  planLabel?: string;
  primaryPhone?: string | null;
  lastUpdatedLabel?: string;
  stats?: DashboardStats;
}) {
  const t = useTranslations("DashboardConfig");
  const locale = useLocale();

  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeTile, setActiveTile] = useState<string | null>(null);

  const catalog = useRealtimeCatalog();
  const availableVoices = useMemo(
    () => voicesForCatalog(catalog, form.model),
    [catalog, form.model],
  );

  // Labels langues traduits stables (refs).
  const primaryLanguages = useMemo(
    () => [
      { value: "fr", flag: "FR", label: t("langFr") },
      { value: "he", flag: "HE", label: t("langHe") },
      { value: "en", flag: "EN", label: t("langEn") },
    ],
    [t],
  );
  const currentLangLabel =
    primaryLanguages.find((l) => l.value === form.primaryLanguage)?.label ??
    form.primaryLanguage;
  const currentLangFlag =
    primaryLanguages.find((l) => l.value === form.primaryLanguage)?.flag ?? "—";

  // Récupère valeur UI 1-10 pour un slider personality (avec mappings spéciaux
  // pour vitesse/créativité qui sont stockés dans form.speed/form.temperature).
  const getPersonalityValue = (key: string): number => {
    if (key === "vitesse") return clamp10(uiFromSpeed(form.speed));
    if (key === "creativite") return clamp10(uiFromTemp(form.temperature));
    return clamp10(form.personality[key as keyof Personality] ?? 5);
  };

  const setPersonalityValue = (key: string, ui: number) => {
    setDirty(true);
    setForm((prev) => {
      const ui10 = clamp10(ui);
      if (key === "vitesse") {
        return { ...prev, speed: speedFromUI(ui10) };
      }
      if (key === "creativite") {
        return { ...prev, temperature: tempFromUI(ui10) };
      }
      return {
        ...prev,
        personality: { ...prev.personality, [key]: ui10 },
      };
    });
  };

  const resetPersonality = () => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      speed: speedFromUI(PERSONALITY_DEFAULT.vitesse!),
      temperature: tempFromUI(PERSONALITY_DEFAULT.creativite!),
      personality: { ...PERSONALITY_DEFAULT },
    }));
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "model") {
        const allowed = voicesForCatalog(catalog, value as string);
        if (!allowed.includes(prev.voice) && allowed.length > 0) {
          next.voice = allowed[0]!;
        }
      }
      return next;
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/dashboard/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSaveFailed"));
        return;
      }
      const timeLocale =
        locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
      setSavedAt(new Date().toLocaleTimeString(timeLocale));
      setDirty(false);
    });
  };

  // ─── TILES — métadata + summary dynamiques ───────────────────────────
  const TILES = [
    {
      id: "voice",
      label: t("voiceTitle"),
      tagline: t("wowTagVoice"),
      summary: `${form.voice} · ${getPersonalityValue("vitesse")}/10`,
      accent: "from-[#06b6d4] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      ),
    },
    {
      id: "persona",
      label: t("personaTitle"),
      tagline: t("wowTagPersona"),
      summary: `${form.inheritAdminGlobals ? t("wowPersonaSummaryInherit") : t("wowPersonaSummaryCustom")} · ${currentLangFlag}`,
      accent: "from-[#be185d] to-[#ec4899]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: "notifs",
      label: t("wowTileNotifs"),
      tagline: t("wowTagNotifs"),
      summary: form.ownerWhatsapp ? t("wowNotifsSummaryActive") : t("wowNotifsSummaryInactive"),
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      ),
    },
  ] as const;

  return (
    <form onSubmit={onSubmit} className="relative pb-24">
      {/* Aurora mesh global est dans le DashboardLayout (couvre tout
       * /dashboard/*). Ici seulement les animations locales. */}

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.3); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce-in {
          0% { opacity: 0; transform: scale(0.92); }
          60% { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .anim-fade-up { animation: fade-up 0.6s ease-out backwards; }
        .anim-bounce-in { animation: bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        .card-hover {
          transition: transform 350ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 350ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 48px -16px rgba(190, 24, 93, 0.30);
        }
        @keyframes bounce-soft { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes pulse-soft { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes flash-soft {
          0%,100% { opacity: 1; transform: scale(1); }
          15% { opacity: 0.5; transform: scale(0.92); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-x { 0%,100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
        @keyframes tilt { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes sparkle {
          0%,100% { transform: scale(1) rotate(0deg); opacity: 1; }
          50% { transform: scale(1.2) rotate(20deg); opacity: 0.85; }
        }
        @keyframes wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-10deg); } 75% { transform: rotate(10deg); } }
        @keyframes pulse-quick {
          0%,100% { transform: scale(1); }
          25% { transform: scale(1.2); }
          50% { transform: scale(0.95); }
          75% { transform: scale(1.1); }
        }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .anim-bounce-soft { animation: bounce-soft 2.4s ease-in-out infinite; }
        .anim-pulse-soft  { animation: pulse-soft 1.6s ease-in-out infinite; }
        .anim-flash       { animation: flash-soft 3s ease-in-out infinite; }
        .anim-slide-x     { animation: slide-x 1.4s ease-in-out infinite; }
        .anim-tilt        { animation: tilt 4s ease-in-out infinite; }
        .anim-sparkle     { animation: sparkle 2.8s ease-in-out infinite; }
        .anim-wiggle      { animation: wiggle 2s ease-in-out infinite; }
        .anim-pulse-quick { animation: pulse-quick 1.2s ease-in-out infinite; }
        .anim-spin-slow   { animation: spin-slow 8s linear infinite; }
        @keyframes ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .ripple-ring {
          position: absolute; inset: 0; border-radius: 9999px;
          border: 2px solid #22d3ee; pointer-events: none;
          animation: ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .ripple-ring--2 { animation-delay: 0.8s; }
        .ripple-ring--3 { animation-delay: 1.6s; }
        .fancy-slider {
          -webkit-appearance: none; appearance: none;
          height: 8px; width: 100%; border-radius: 9999px;
          outline: none; background: transparent;
        }
        .fancy-slider::-webkit-slider-runnable-track {
          height: 8px; border-radius: 9999px; background: inherit;
        }
        .fancy-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; margin-top: -7px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45),
                      0 0 0 1px rgba(14, 116, 144, 0.18);
          cursor: grab;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fancy-slider:hover::-webkit-slider-thumb {
          transform: scale(1.15);
          box-shadow: 0 4px 16px -2px rgba(14, 116, 144, 0.5),
                      0 0 0 6px rgba(34, 211, 238, 0.18);
        }
        .fancy-slider:active::-webkit-slider-thumb,
        .fancy-slider:focus::-webkit-slider-thumb {
          cursor: grabbing; transform: scale(1.25);
          box-shadow: 0 4px 20px -2px rgba(14, 116, 144, 0.6),
                      0 0 0 8px rgba(34, 211, 238, 0.22);
        }
        .fancy-slider::-moz-range-track {
          height: 8px; border-radius: 9999px; background: inherit; border: none;
        }
        .fancy-slider::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45);
          cursor: grab; transition: transform 220ms, box-shadow 220ms;
        }
        .fancy-slider:disabled { opacity: 0.5; cursor: not-allowed; }
        .fancy-slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-bounce-in, .anim-bounce-soft, .anim-pulse-soft,
          .anim-flash, .anim-slide-x, .anim-tilt, .anim-sparkle, .anim-wiggle,
          .anim-pulse-quick, .anim-spin-slow, .ripple-ring { animation: none; }
          .card-hover { transition: none; }
          .card-hover:hover { transform: none; }
        }
      `}</style>

      <div className="relative">
        {/* ── HERO + LIVE STATUS ──────────────────────────────────────── */}
        <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div
            className="card-hover anim-fade-up relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/55 p-7 shadow-[0_8px_40px_-12px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-10 lg:col-span-8"
            style={{ animationDelay: "60ms" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gradient-to-br from-[#22d3ee]/30 to-[#ec4899]/20 blur-3xl motion-safe:animate-[aurora_15s_ease-in-out_infinite]"
            />

            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#be185d]">
              {t("heroEyebrow")} ·{" "}
              <span className="inline-flex items-center gap-1 text-[#0e7490]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                {t("heroLive")}
              </span>
            </p>

            {primaryPhone ? (
              <p
                className="mt-4 break-words bg-gradient-to-r from-[#0e7490] via-[#be185d] to-[#ec4899] bg-clip-text font-display text-4xl font-bold leading-[0.95] tracking-tight tabular-nums text-transparent drop-shadow-[0_2px_24px_rgba(190,24,93,0.18)] sm:text-6xl"
                style={{
                  fontFeatureSettings: '"tnum"',
                  backgroundSize: "200% 100%",
                  animation: "shimmer 8s linear infinite",
                }}
              >
                {primaryPhone}
              </p>
            ) : (
              <p className="mt-4 text-base text-[#475569]">{t("heroNoPhone")}</p>
            )}

            {stats && (
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-[#fbcfe8]/60 pt-6">
                <Stat
                  label={t("wowStatCallsToday")}
                  value={stats.callsToday.toString()}
                  tone="cyan"
                />
                <Stat
                  label={t("wowStatMinutesMonth")}
                  value={`${stats.minutesThisMonth} min`}
                  tone="cyan"
                />
                <Stat
                  label={t("wowStatConversion")}
                  value={`${stats.conversion}%`}
                  tone="teal"
                />
                <Stat
                  label={t("wowStatAvgDuration")}
                  value={stats.avgDuration}
                  tone="teal"
                />
                <Stat
                  label={t("wowStatRdv")}
                  value={stats.rdv.toString()}
                  tone="primary"
                />
              </div>
            )}

            {lastUpdatedLabel && (
              <p className="mt-3 text-xs text-[#475569]">
                {t("lastUpdated")} {lastUpdatedLabel}
              </p>
            )}
          </div>

          {/* Statut card cyan */}
          <div
            className="card-hover anim-fade-up relative flex flex-col gap-5 overflow-hidden rounded-[2rem] border border-white/40 bg-gradient-to-br from-[#0891b2] via-[#0e7490] to-[#155e75] p-7 text-white shadow-[0_8px_40px_-12px_rgba(14,116,144,0.4)] lg:col-span-4"
            style={{ animationDelay: "140ms" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-12 h-48 w-48 rounded-full bg-white/15 blur-2xl"
            />

            <div className="relative flex items-start justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                {t("wowStatusLabel")}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22d3ee]/20 px-2.5 py-1 text-[10px] font-semibold text-[#a5f3fc] ring-1 ring-inset ring-[#22d3ee]/40 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-80 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                {t("wowLiveLabel")}
              </span>
            </div>

            {/* Waveform alterné blanc/cyan */}
            <div className="relative flex h-28 items-center justify-center gap-1.5">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full motion-safe:animate-[wave_1.2s_ease-in-out_infinite]"
                  style={{
                    height: `${20 + Math.sin(i * 0.8) * 30 + 30}%`,
                    animationDelay: `${i * 80}ms`,
                    backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.9)" : "#22d3ee",
                    boxShadow: i % 2 === 1 ? "0 0 8px rgba(34,211,238,0.6)" : "none",
                  }}
                />
              ))}
            </div>

            <div className="relative space-y-2.5">
              <Meta label={t("heroVoiceLabel")} value={form.voice} />
              <Meta label={t("heroLanguageLabel")} value={currentLangLabel} />
              <Meta label={t("wowPlanLabel")} value={planLabel || "—"} />
            </div>
          </div>
        </section>

        {/* ── LIVE TEST ───────────────────────────────────────────────── */}
        <section
          className="card-hover anim-fade-up mb-8"
          style={{ animationDelay: "220ms" }}
        >
          {/* Phase 2 : LiveTestPanelLK route via LiveKit (worker QVF 2.1 L)
           *  au lieu du peer connection direct vers OpenAI. La config est
           *  désormais lue depuis la DB par le worker — d'où le warning
           *  "save before testing" si le form est dirty. */}
          <LiveTestPanelLK dirty={dirty} />
        </section>

        {/* ── TILE GRID ───────────────────────────────────────────────── */}
        <section className="mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-extrabold tracking-tight text-[#18181b] sm:text-2xl">
              {t("header")}
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              {activeTile ? t("wowTileHintActive") : t("wowTileHintIdle")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {TILES.map((tile, i) => (
              <Tile
                key={tile.id}
                tile={tile}
                active={activeTile === tile.id}
                onClick={() =>
                  setActiveTile((curr) => (curr === tile.id ? null : tile.id))
                }
                delay={300 + i * 60}
              />
            ))}
            <AddTile delay={300 + TILES.length * 60} />
          </div>

          {activeTile && (
            <div
              key={activeTile}
              className="anim-fade-up mt-5 overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 shadow-[0_4px_24px_-8px_rgba(190,24,93,0.15)] backdrop-blur-xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-6 py-4 sm:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${TILES.find((t) => t.id === activeTile)?.accent} text-white shadow-md`}
                  >
                    {TILES.find((t) => t.id === activeTile)?.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-extrabold tracking-tight text-[#18181b] sm:text-xl">
                      {TILES.find((t) => t.id === activeTile)?.label}
                    </h3>
                    <p className="truncate text-xs text-[#475569]">
                      {TILES.find((t) => t.id === activeTile)?.summary}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTile(null)}
                  aria-label={t("wowCloseAria")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </header>

              <div className="px-6 py-6 sm:px-8 sm:py-7">
                {activeTile === "voice" && (
                  <VoicePanel
                    form={form}
                    update={update}
                    availableVoices={availableVoices}
                    isAdmin={isAdmin}
                    catalogModels={catalog.models}
                    getPersonalityValue={getPersonalityValue}
                    setPersonalityValue={setPersonalityValue}
                    resetPersonality={resetPersonality}
                  />
                )}
                {activeTile === "persona" && (
                  <PersonaPanel
                    form={form}
                    update={update}
                    primaryLanguages={primaryLanguages}
                    adminInheritablePreview={adminInheritablePreview}
                    planLabel={planLabel}
                    t={t}
                  />
                )}
                {activeTile === "notifs" && (
                  <NotifsPanel form={form} update={update} t={t} />
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Floating save dock — aligné sur le visuel wow ───────────── */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-6">
        <div
          className="pointer-events-auto flex items-center gap-4 rounded-full border border-white/50 bg-white/85 px-2 py-2 pl-5 shadow-[0_12px_40px_-8px_rgba(190,24,93,0.25)] backdrop-blur-xl anim-fade-up"
          style={{ animationDelay: "700ms" }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-[#831843]">
            {error ? (
              <span className="font-semibold text-[#dc2626]">{error}</span>
            ) : dirty ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#be185d]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#be185d] motion-safe:animate-pulse" />
                {t("unsavedChanges")}
              </span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1.5 text-[#0e7490]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                {t("savedAt", { time: savedAt })}
              </span>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                {t("upToDate")}
              </>
            )}
          </span>
          <button
            type="submit"
            disabled={isPending}
            className="group rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-5 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-1.5">
              {isPending ? t("saving") : t("saveButton")}
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Tile + AddTile ─────────────────────────────────────────────────────

type TileDef = {
  id: string;
  label: string;
  tagline: string;
  summary: string;
  accent: string;
  icon: React.ReactNode;
};

function Tile({
  tile,
  active,
  onClick,
  delay = 0,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
  delay?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`anim-bounce-in group relative flex aspect-square flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
        active
          ? "border-[#0e7490] bg-white shadow-[0_8px_32px_-8px_rgba(14,116,144,0.4)] -translate-y-0.5"
          : "border-white/40 bg-white/70 backdrop-blur-xl hover:-translate-y-1 hover:border-[#0e7490]/40 hover:bg-white hover:shadow-lg"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {active && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tile.accent} opacity-15 blur-2xl`}
        />
      )}
      <span
        className={`relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tile.accent} text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3`}
      >
        {tile.icon}
      </span>
      <div className="relative w-full min-w-0">
        <p className="text-base font-extrabold tracking-tight text-[#18181b]">
          {tile.label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium italic leading-snug text-[#0e7490]">
          {tile.tagline}
        </p>
        <p className="mt-1 truncate text-[10px] text-[#475569]">{tile.summary}</p>
      </div>
      {active && (
        <span
          aria-hidden
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#0e7490] motion-safe:animate-pulse"
        />
      )}
    </button>
  );
}

function AddTile({ delay = 0 }: { delay?: number }) {
  const t = useTranslations("DashboardConfig");
  return (
    <div
      className="anim-bounce-in flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/30 p-4 text-[#94a3b8] backdrop-blur"
      style={{ animationDelay: `${delay}ms` }}
      title={t("wowAddTileTitle")}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e1]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <p className="text-center text-[11px] font-medium">{t("wowComingSoon")}</p>
    </div>
  );
}

// ─── Panels ─────────────────────────────────────────────────────────────

function VoicePanel({
  form,
  update,
  availableVoices,
  isAdmin,
  catalogModels,
  getPersonalityValue,
  setPersonalityValue,
  resetPersonality,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  availableVoices: ReadonlyArray<string>;
  isAdmin: boolean;
  catalogModels: ReadonlyArray<{ id: string; provider: string }>;
  getPersonalityValue: (key: string) => number;
  setPersonalityValue: (key: string, ui: number) => void;
  resetPersonality: () => void;
}) {
  const t = useTranslations("DashboardConfig");

  // Maps traduits dynamiquement (dépendent de la locale active).
  const voiceDescMap = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const v of VOICE_IDS) {
      const key = `wowVoiceDesc${cap(v)}` as const;
      out[v] = t(key);
    }
    return out;
  }, [t]);

  const sliderDefs = useMemo(
    () =>
      PERSONALITY_SLIDER_META.map((m) => ({
        ...m,
        label: t(`wowSlider${cap(m.key)}Label` as const),
        min: t(`wowSlider${cap(m.key)}Min` as const),
        max: t(`wowSlider${cap(m.key)}Max` as const),
        badge: m.badge ?? t("wowComingSoon"),
      })),
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Modèle */}
      {isAdmin ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("modelLabel")}
          </p>
          <select
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
          >
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[#0e7490]">{t("modelHint")}</p>
        </div>
      ) : (
        <Tag label={t("modelLabel")} value={form.model} lock />
      )}

      {/* Voice picker avec gender */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("voiceLabel")}
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {availableVoices.map((v) => {
            const active = v === form.voice;
            const gender = VOICE_GENDER[v] ?? "m";
            const isF = gender === "f";
            const desc = voiceDescMap[v] ?? "";
            const activeGradient = isF
              ? "from-[#be185d] to-[#ec4899]"
              : "from-[#06b6d4] to-[#0e7490]";
            const inactiveHover = isF
              ? "hover:border-[#be185d]/40"
              : "hover:border-[#0e7490]/40";
            const inactivePlay = isF
              ? "bg-[#fdf2f8] text-[#be185d]"
              : "bg-[#ecfeff] text-[#0e7490]";
            const inactiveBadge = isF
              ? "text-[#be185d] bg-[#fdf2f8] ring-[#fbcfe8]"
              : "text-[#0e7490] bg-[#ecfeff] ring-[#22d3ee]/40";
            return (
              <button
                key={v}
                type="button"
                onClick={() => update("voice", v)}
                className={`group flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-300 ${
                  active
                    ? `border-transparent bg-gradient-to-br ${activeGradient} text-white shadow-md`
                    : `border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:bg-white hover:shadow-md ${inactiveHover}`
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">{v}</p>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset transition-colors ${
                        active
                          ? "bg-white/20 text-white ring-white/30"
                          : inactiveBadge
                      }`}
                    >
                      {isF ? "F" : "M"}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-[11px] ${active ? "text-white/75" : "text-[#475569]"}`}
                  >
                    {isF ? t("wowGenderF") : t("wowGenderM")}
                    {desc ? ` · ${desc}` : ""}
                  </p>
                </div>
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                    active
                      ? "scale-110 bg-white/20 text-white"
                      : `${inactivePlay} group-hover:scale-110`
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-3 w-3">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-[#475569]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899]" />
            {t("wowGenderF")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0e7490]" />
            {t("wowGenderM")}
          </span>
        </div>
      </div>

      {/* Réduction de bruit — Quail Voice Focus 2.1 L (ai-coustics), 1-10 */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#fdf2f8]/40 to-white/60 p-5 sm:p-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#be185d]">
            {t("wowNoiseTitle")}
          </p>
          <span className="rounded-full bg-[#be185d]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#be185d]">
            Quail VF 2.1 L
          </span>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-[#475569]">
          {t("wowNoiseSubtitle")}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[11px] text-[#475569]">
            <span>{t("wowNoiseMin")}</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-[#be185d]">
              {form.noiseReductionLevel}
              <span className="text-[10px] font-normal text-[#94a3b8]"> / 10</span>
            </span>
            <span>{t("wowNoiseMax")}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={form.noiseReductionLevel}
            onChange={(e) =>
              update("noiseReductionLevel", Number(e.target.value))
            }
            aria-label={t("wowNoiseTitle")}
            className="w-full accent-[#be185d]"
            style={{
              background: `linear-gradient(to right, #be185d 0%, #ec4899 ${
                ((form.noiseReductionLevel - 1) / 9) * 100
              }%, #e2e8f0 ${
                ((form.noiseReductionLevel - 1) / 9) * 100
              }%, #e2e8f0 100%)`,
              height: 6,
              borderRadius: 9999,
              appearance: "none",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Personnalité — 9 sliders, 3 enabled (vitesse/créativité/réactivité) */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/40 to-white/60 p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("wowPersonalityTitle")}
          </p>
          <button
            type="button"
            onClick={resetPersonality}
            className="text-[10px] font-medium text-[#475569] underline-offset-4 hover:underline"
          >
            {t("wowReset")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
          {sliderDefs.map((s) => (
            <PersonalitySlider
              key={s.key}
              label={s.label}
              value={getPersonalityValue(s.key)}
              onChange={(v) => setPersonalityValue(s.key, v)}
              minLabel={s.min}
              maxLabel={s.max}
              icon={s.icon}
              animClass={s.anim}
              enabled={s.enabled}
              badge={s.badge}
              midLabel={t("wowSliderMid")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonaPanel({
  form,
  update,
  primaryLanguages,
  adminInheritablePreview,
  planLabel,
  t,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  primaryLanguages: ReadonlyArray<{ value: string; flag: string; label: string }>;
  adminInheritablePreview: string;
  planLabel: string;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Inherit mode */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/50 to-white/30 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {planLabel
            ? t("wowModeTitleWithPlan", { plan: planLabel })
            : t("wowModeTitle")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <RadioCard
            active={form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", true)}
            title={t("inheritAdminLabel")}
            desc={t("inheritAdminHelp")}
          />
          <RadioCard
            active={!form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", false)}
            title={t("wowModeCustom")}
            desc={t("wowModeCustomDesc")}
          />
        </div>
        {form.inheritAdminGlobals && adminInheritablePreview && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[10px] text-[#0e7490] hover:underline">
              {t("wowViewInherited")}
            </summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-[10px] leading-relaxed text-[#18181b]">
              {adminInheritablePreview}
            </pre>
          </details>
        )}
      </div>

      {/* Langue */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("primaryLanguageLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          {primaryLanguages.map((l) => {
            const active = l.value === form.primaryLanguage;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => update("primaryLanguage", l.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "border-transparent bg-[#18181b] text-white shadow-md"
                    : "border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:shadow-sm"
                }`}
              >
                <span className="font-mono text-[10px] opacity-70">{l.flag}</span>
                {l.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("primaryLanguageHint")}
        </p>
      </div>

      {/* Agent name (facultatif) — prononcé dans la phrase d'accueil */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("wowAgentNameLabel")}
          </p>
          <span className="text-[10px] text-[#94a3b8]">
            {t("wowOptional")}
          </span>
        </div>
        <input
          type="text"
          value={form.agentName}
          onChange={(e) => update("agentName", e.target.value)}
          placeholder={t("wowAgentNamePlaceholder")}
          maxLength={80}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("wowAgentNameHint")}
        </p>
      </div>

      {/* Greeting */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("greetingLabel")}
        </p>
        <input
          type="text"
          value={form.greetingInstructions}
          onChange={(e) => update("greetingInstructions", e.target.value)}
          placeholder={t("greetingPlaceholder")}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">{t("greetingHint")}</p>
      </div>

      {/* Instructions */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("instructionsLabel")}
        </p>
        <textarea
          value={form.instructions}
          onChange={(e) => update("instructions", e.target.value)}
          rows={12}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-3 font-mono text-xs leading-relaxed text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">{t("instructionsHint")}</p>
      </div>
    </div>
  );
}

function NotifsPanel({
  form,
  update,
  t,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  // Local-only state for SMS/Email (pas encore en DB)
  const [smsOn, setSmsOn] = useState(false);
  const [smsValue, setSmsValue] = useState("");
  const [emailOn, setEmailOn] = useState(false);
  const [emailValue, setEmailValue] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <NotifChannelCard
        label="WhatsApp"
        color="#25D366"
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.81 11.81 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413Z" />
          </svg>
        }
        on={Boolean(form.ownerWhatsapp)}
        onToggle={(v) => {
          if (!v) update("ownerWhatsapp", "");
        }}
        value={form.ownerWhatsapp}
        onChangeValue={(v) => update("ownerWhatsapp", v)}
        placeholder="+972..."
        inputType="tel"
        hint={t("ownerWhatsappHint")}
        testEndpoint="/api/dashboard/notifications/whatsapp-test"
      />
      <NotifChannelCard
        label="SMS"
        color="#3B82F6"
        comingSoon
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        }
        on={smsOn}
        onToggle={setSmsOn}
        value={smsValue}
        onChangeValue={setSmsValue}
        placeholder="+972..."
        inputType="tel"
      />
      <NotifChannelCard
        label="Email"
        color="#0e7490"
        comingSoon
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 6-10 7L2 6" />
          </svg>
        }
        on={emailOn}
        onToggle={setEmailOn}
        value={emailValue}
        onChangeValue={setEmailValue}
        placeholder="contact@..."
        inputType="email"
      />
      <p className="rounded-xl bg-[#ecfeff]/60 px-4 py-3 text-[11px] leading-relaxed text-[#475569]">
        {t("whatsappFooter")}
      </p>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function PersonalitySlider({
  label,
  value,
  onChange,
  minLabel,
  maxLabel,
  midLabel,
  icon,
  animClass,
  enabled,
  badge,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
  midLabel: string;
  icon?: React.ReactNode;
  animClass?: string;
  enabled: boolean;
  badge?: string;
}) {
  const pct = ((value - 1) / 9) * 100;
  const trackGradient = enabled
    ? `linear-gradient(to right, #0891b2 0%, #22d3ee ${pct}%, #e0f7fa ${pct}%, #cffafe 100%)`
    : `linear-gradient(to right, #94a3b8 0%, #cbd5e1 ${pct}%, #f1f5f9 ${pct}%, #f1f5f9 100%)`;

  return (
    <div className={enabled ? "" : "opacity-60"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${enabled ? "from-[#ecfeff] to-[#cffafe] text-[#0e7490] ring-[#22d3ee]/30" : "from-[#f1f5f9] to-[#e2e8f0] text-[#94a3b8] ring-[#cbd5e1]"} ring-1 ring-inset ${enabled ? animClass ?? "" : ""}`}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                {icon}
              </svg>
            </span>
          )}
          <p className="truncate text-sm font-semibold text-[#18181b]">
            {label}
          </p>
          {badge && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset ${
                enabled
                  ? "bg-[#ecfeff] text-[#0e7490] ring-[#22d3ee]/40"
                  : "bg-[#f1f5f9] text-[#94a3b8] ring-[#cbd5e1]"
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-gradient-to-br ${enabled ? "from-[#ecfeff] to-[#cffafe] text-[#0e7490] ring-[#22d3ee]/40" : "from-[#f1f5f9] to-[#e2e8f0] text-[#94a3b8] ring-[#cbd5e1]"} px-2 py-0.5 font-mono text-[11px] font-bold ring-1 ring-inset shadow-sm`}
        >
          {value}
          <span className="opacity-50">/10</span>
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={!enabled}
        aria-label={label}
        aria-valuetext={`${value}/10 — ${value <= 3 ? minLabel : value >= 8 ? maxLabel : midLabel}`}
        className="fancy-slider"
        style={{ background: trackGradient }}
      />
      <div className="mt-2 flex justify-between gap-2 text-[10px] leading-tight text-[#475569]">
        <span
          className={`max-w-[45%] transition-colors ${
            enabled && value <= 3 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {minLabel}
        </span>
        <span
          className={`max-w-[45%] text-right transition-colors ${
            enabled && value >= 8 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {maxLabel}
        </span>
      </div>
    </div>
  );
}

function RadioCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`group flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition-all duration-300 ${
        active
          ? "border-[#0e7490] bg-white shadow-[0_4px_16px_-6px_rgba(14,116,144,0.35)]"
          : "border-[#e2e8f0] bg-white/50 hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:bg-white/90"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
          active
            ? "border-[#0e7490] bg-[#0e7490]"
            : "border-[#cbd5e1] bg-white group-hover:border-[#0e7490]/60"
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#18181b]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#475569]">{desc}</p>
      </div>
    </button>
  );
}

function NotifChannelCard({
  label,
  icon,
  color,
  on,
  onToggle,
  value,
  onChangeValue,
  placeholder,
  inputType,
  hint,
  comingSoon = false,
  testEndpoint,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChangeValue: (v: string) => void;
  placeholder: string;
  inputType: string;
  hint?: string;
  comingSoon?: boolean;
  /** Si fourni, POST {to: value} sur cet endpoint quand l'utilisateur
   *  clique sur Tester. Sans endpoint, le bouton reste désactivé (les
   *  canaux "coming soon" SMS/Email tombent sur cette branche). */
  testEndpoint?: string;
}) {
  const t = useTranslations("DashboardConfig");
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const handleTest = async () => {
    if (
      !on ||
      testStatus !== "idle" ||
      comingSoon ||
      !testEndpoint ||
      !value.trim()
    )
      return;
    setTestStatus("sending");
    setTestError(null);
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: value }),
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as { ok?: boolean; error?: string; hint?: string };
      if (!res.ok || !data.ok) {
        setTestStatus("error");
        setTestError(data.error ?? `HTTP ${res.status}`);
        setTimeout(() => {
          setTestStatus("idle");
          setTestError(null);
        }, 6000);
        return;
      }
      setTestStatus("sent");
      setTimeout(() => setTestStatus("idle"), 3500);
    } catch (e) {
      setTestStatus("error");
      setTestError((e as Error).message);
      setTimeout(() => {
        setTestStatus("idle");
        setTestError(null);
      }, 6000);
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on && !comingSoon
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : "border-[#e2e8f0] bg-white/50"
      } ${comingSoon ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on && !comingSoon ? color : "#f1f5f9",
              color: on && !comingSoon ? "white" : "#94a3b8",
              boxShadow:
                on && !comingSoon ? `0 4px 16px -4px ${color}66` : "none",
            }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-[#18181b]">
                {label}
              </p>
              {comingSoon && (
                <span className="shrink-0 rounded-full bg-[#f1f5f9] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#94a3b8] ring-1 ring-inset ring-[#cbd5e1]">
                  {t("wowComingSoon")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#475569]">
              {on && !comingSoon ? (
                <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                  {t("wowChannelActive")}
                </span>
              ) : (
                t("wowChannelInactive")
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on && !comingSoon}
          aria-label={t("wowToggleAria", { action: on ? t("wowToggleDisable") : t("wowToggleEnable"), label })}
          onClick={() => !comingSoon && onToggle(!on)}
          disabled={comingSoon}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
            on && !comingSoon
              ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
              : "bg-[#cbd5e1]"
          }`}
        >
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: on && !comingSoon ? "translateX(20px)" : "translateX(0)",
            }}
          />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={!on || comingSoon}
          className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={
            !on ||
            testStatus !== "idle" ||
            comingSoon ||
            !testEndpoint ||
            !value.trim()
          }
          aria-label={t("wowTestAria", { label })}
          className={`group inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            testStatus === "sent"
              ? "border-[#22d3ee]/40 bg-[#ecfeff] text-[#0e7490]"
              : testStatus === "error"
                ? "border-[#dc2626]/40 bg-[#fee2e2] text-[#991b1b]"
                : "border-[#0e7490]/30 bg-white text-[#0e7490] hover:-translate-y-0.5 hover:border-[#0e7490] hover:bg-[#ecfeff] hover:shadow-sm"
          }`}
        >
          {testStatus === "sending" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 motion-safe:animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {t("wowTestSending")}
            </>
          ) : testStatus === "sent" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("wowTestSent")}
            </>
          ) : testStatus === "error" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              Échec
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t("wowTestButton")}
            </>
          )}
        </button>
      </div>

      {testError && (
        <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] leading-snug text-[#991b1b]">
          {testError}
        </p>
      )}
      {hint && !testError && <p className="text-[11px] text-[#475569]">{hint}</p>}
    </div>
  );
}

function Tag({
  label,
  value,
  lock = false,
}: {
  label: string;
  value: string;
  lock?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#22d3ee]/25 bg-gradient-to-r from-[#ecfeff] to-[#fdf2f8] px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {label}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs font-semibold text-[#18181b]">
          {value}
        </p>
      </div>
      {lock && (
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#0e7490]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "cyan" | "teal";
}) {
  const valueColor =
    tone === "primary"
      ? "text-[#be185d]"
      : tone === "cyan"
        ? "text-[#0891b2]"
        : tone === "teal"
          ? "text-[#0e7490]"
          : "text-[#18181b]";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-bold tabular-nums ${valueColor}`}
      >
        {value}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">
        {label}
      </p>
      <p className="truncate font-mono text-sm font-medium">{value}</p>
    </div>
  );
}
