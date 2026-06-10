"use client";

import NextLink from "next/link";
import { useState } from "react";

type Gender = "f" | "m";

const VOICES: ReadonlyArray<{
  id: string;
  name: string;
  desc: string;
  gender: Gender;
}> = [
  { id: "marin", name: "Marin", desc: "Chaleureuse, médium", gender: "f" },
  { id: "ballad", name: "Ballad", desc: "Posée, grave", gender: "m" },
  { id: "sage", name: "Sage", desc: "Calme, conseil", gender: "f" },
  { id: "verse", name: "Verse", desc: "Énergique, claire", gender: "m" },
  { id: "alloy", name: "Alloy", desc: "Neutre, pro", gender: "m" },
  { id: "shimmer", name: "Shimmer", desc: "Douce, lumineuse", gender: "f" },
];

const GENDER_LABEL: Record<Gender, string> = {
  f: "Féminine",
  m: "Masculine",
};

const LANGUAGES = [
  { id: "fr", flag: "FR", name: "Français" },
  { id: "he", flag: "HE", name: "עברית" },
  { id: "en", flag: "EN", name: "English" },
];

type NotifChannel = "whatsapp" | "sms" | "email";

// 9 dimensions de personnalité (1-10) — chacune avec labels min/max
// affichés sous le slider pour donner le sens du curseur, + une icône SVG
// avec une mini-animation propre à la dimension (slow, subtle, toujours en cours).
const PERSONALITY_SLIDERS = [
  {
    key: "vitesse",
    label: "Vitesse de parole",
    min: "Très lente",
    max: "Rapide et rythmée",
    anim: "anim-slide-x",
    icon: (
      <>
        <polygon points="13 19 22 12 13 5 13 19" />
        <polygon points="2 19 11 12 2 5 2 19" />
      </>
    ),
  },
  {
    key: "creativite",
    label: "Créativité",
    min: "Structurée et littérale",
    max: "Très spontanée et originale",
    anim: "anim-sparkle",
    icon: (
      <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
    ),
  },
  {
    key: "reactivite",
    label: "Réactivité",
    min: "Réponses plus posées",
    max: "Ultra-réactive et fluide",
    anim: "anim-pulse-quick",
    icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  },
  {
    key: "joie",
    label: "Joie",
    min: "Neutre, peu expressive",
    max: "Très joyeuse et enthousiaste",
    anim: "anim-bounce-soft",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </>
    ),
  },
  {
    key: "empathie",
    label: "Empathie",
    min: "Factuelle, distante",
    max: "Très chaleureuse et bienveillante",
    anim: "anim-pulse-soft",
    icon: (
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    ),
  },
  {
    key: "dynamisme",
    label: "Dynamisme",
    min: "Calme, posée",
    max: "Pleine d'énergie et dynamique",
    anim: "anim-flash",
    icon: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  },
  {
    key: "professionnel",
    label: "Ton Professionnel",
    min: "Très décontracté",
    max: "Très professionnel et élégant",
    anim: "anim-tilt",
    icon: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </>
    ),
  },
  {
    key: "humour",
    label: "Légèreté / Humour",
    min: "Très sérieux",
    max: "Copine festive, fun et taquine",
    anim: "anim-wiggle",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M7 13a5 5 0 0 0 10 0" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </>
    ),
  },
  {
    key: "accent",
    label: "Accent",
    min: "Accent neutre / international",
    max: "Accent marqué de la langue principale",
    anim: "anim-spin-slow",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    ),
  },
] as const;

type PersonalityKey = (typeof PERSONALITY_SLIDERS)[number]["key"];
type Personality = Record<PersonalityKey, number>;

const PERSONALITY_DEFAULT: Personality = {
  joie: 6,
  empathie: 8,
  dynamisme: 7,
  vitesse: 5,
  professionnel: 7,
  creativite: 5,
  humour: 4,
  reactivite: 8,
  accent: 3,
};

export function WowDashboard() {
  const [voice, setVoice] = useState("marin");
  const [lang, setLang] = useState("fr");
  const [personality, setPersonality] = useState<Personality>(PERSONALITY_DEFAULT);
  const [inheritMode, setInheritMode] = useState<"inherit" | "custom">("inherit");
  const [greeting, setGreeting] = useState(
    "Bonjour, c'est Sarah du salon Prestige Coiffure. Comment puis-je vous aider ?",
  );
  const [instructions, setInstructions] = useState(
    `Tu es Sarah, secrétaire IA du salon Prestige Coiffure à Ashdod.

Horaires : 9h-19h dimanche-jeudi. Fermé vendredi-samedi.
Prestations : coupe 60min · couleur 90min · brushing 30min.
Ton chaleureux, jamais familier. Réponses courtes (1-2 phrases).`,
  );
  const [notifs, setNotifs] = useState<Record<NotifChannel, boolean>>({
    whatsapp: true,
    sms: false,
    email: true,
  });
  const [notifValues, setNotifValues] = useState({
    whatsapp: "+972 58 500 1007",
    sms: "+972 58 500 1007",
    email: "sarah@prestige.com",
  });
  const [activeTile, setActiveTile] = useState<string | null>(null);

  const activeNotifCount = Object.values(notifs).filter(Boolean).length;

  // Définition centralisée des tuiles — pour ajouter une carte, push un objet
  // dans ce tableau + ajouter le panel correspondant en bas du JSX. Voilà.
  const TILES = [
    {
      id: "voice",
      label: "Voix",
      tagline: "Le timbre, le rythme, l'âme.",
      summary: `${VOICES.find((v) => v.id === voice)?.name ?? "—"} · 9 dimensions`,
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
      label: "Persona",
      tagline: "Qui elle est, comment elle parle.",
      summary: `${inheritMode === "inherit" ? "Hérite admin" : "Personnalisé"} · ${LANGUAGES.find((l) => l.id === lang)?.flag ?? "—"}`,
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
      label: "Notifications",
      tagline: "Reste connectée à tes appels.",
      summary: activeNotifCount === 0
        ? "Aucun canal actif"
        : `${activeNotifCount} canal actif${activeNotifCount > 1 ? "s" : ""}`,
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
    <div className="relative min-h-screen overflow-hidden bg-[#FAF7F2]">
      {/* ── Aurora mesh background animé — rose + cyan voice tech ─────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 motion-safe:animate-[aurora_20s_ease-in-out_infinite]"
        style={{
          background: `
            radial-gradient(at 15% 20%, rgba(236, 72, 153, 0.35) 0px, transparent 50%),
            radial-gradient(at 85% 12%, rgba(34, 211, 238, 0.32) 0px, transparent 55%),
            radial-gradient(at 50% 85%, rgba(190, 24, 93, 0.25) 0px, transparent 60%),
            radial-gradient(at 90% 70%, rgba(34, 211, 238, 0.22) 0px, transparent 50%),
            radial-gradient(at 10% 75%, rgba(14, 116, 144, 0.18) 0px, transparent 55%)
          `,
        }}
      />

      <style>{`
        @keyframes aurora {
          0%, 100% { transform: scale(1) translate(0, 0); }
          33% { transform: scale(1.05) translate(2%, -1%); }
          66% { transform: scale(0.98) translate(-1%, 2%); }
        }
        @keyframes wave {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.3); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(190, 24, 93, 0); }
          50% { box-shadow: 0 0 24px 4px rgba(190, 24, 93, 0.15); }
        }
        @keyframes bounce-in {
          0% { opacity: 0; transform: scale(0.92); }
          60% { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
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
        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-bounce-in { animation: none; opacity: 1; transform: none; }
          .card-hover { transition: none; }
          .card-hover:hover { transform: none; }
        }

        /* ── Icon mini-animations (subtle, always-on) ─────────────────── */
        @keyframes bounce-soft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes pulse-soft {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes flash-soft {
          0%, 100% { opacity: 1; transform: scale(1); }
          15% { opacity: 0.5; transform: scale(0.92); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-x {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(3px); }
        }
        @keyframes tilt {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes sparkle {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
          50% { transform: scale(1.2) rotate(20deg); opacity: 0.85; }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-10deg); }
          75% { transform: rotate(10deg); }
        }
        @keyframes pulse-quick {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.2); }
          50% { transform: scale(0.95); }
          75% { transform: scale(1.1); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .anim-bounce-soft { animation: bounce-soft 2.4s ease-in-out infinite; }
        .anim-pulse-soft  { animation: pulse-soft 1.6s ease-in-out infinite; }
        .anim-flash       { animation: flash-soft 3s ease-in-out infinite; }
        .anim-slide-x     { animation: slide-x 1.4s ease-in-out infinite; }
        .anim-tilt        { animation: tilt 4s ease-in-out infinite; }
        .anim-sparkle     { animation: sparkle 2.8s ease-in-out infinite; }
        .anim-wiggle      { animation: wiggle 2s ease-in-out infinite; }
        .anim-pulse-quick { animation: pulse-quick 1.2s ease-in-out infinite; }
        .anim-spin-slow   { animation: spin-slow 8s linear infinite; }

        /* ── Ripple rings (mic button) — 3 anneaux qui se propagent ────── */
        @keyframes ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .ripple-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid #22d3ee;
          pointer-events: none;
          animation: ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .ripple-ring--2 { animation-delay: 0.8s; }
        .ripple-ring--3 { animation-delay: 1.6s; }
        @media (prefers-reduced-motion: reduce) {
          .anim-bounce-soft, .anim-pulse-soft, .anim-flash, .anim-slide-x,
          .anim-tilt, .anim-sparkle, .anim-wiggle, .anim-pulse-quick,
          .anim-spin-slow, .ripple-ring { animation: none; }
        }

        /* ── Fancy slider — track gradient + thumb gradient + glow ─────── */
        .fancy-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          width: 100%;
          border-radius: 9999px;
          outline: none;
          background: transparent; /* track est rendu via inline style ::-webkit-slider-runnable-track */
        }
        /* WebKit track (Chrome / Safari / Edge) */
        .fancy-slider::-webkit-slider-runnable-track {
          height: 8px;
          border-radius: 9999px;
          background: inherit; /* hérite du style inline du <input> */
        }
        .fancy-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          margin-top: -7px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow:
            0 2px 8px -1px rgba(14, 116, 144, 0.45),
            0 0 0 1px rgba(14, 116, 144, 0.18);
          cursor: grab;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fancy-slider:hover::-webkit-slider-thumb {
          transform: scale(1.15);
          box-shadow:
            0 4px 16px -2px rgba(14, 116, 144, 0.5),
            0 0 0 6px rgba(34, 211, 238, 0.18);
        }
        .fancy-slider:active::-webkit-slider-thumb,
        .fancy-slider:focus::-webkit-slider-thumb {
          cursor: grabbing;
          transform: scale(1.25);
          box-shadow:
            0 4px 20px -2px rgba(14, 116, 144, 0.6),
            0 0 0 8px rgba(34, 211, 238, 0.22);
        }
        /* Firefox */
        .fancy-slider::-moz-range-track {
          height: 8px;
          border-radius: 9999px;
          background: inherit;
          border: none;
        }
        .fancy-slider::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow:
            0 2px 8px -1px rgba(14, 116, 144, 0.45),
            0 0 0 1px rgba(14, 116, 144, 0.18);
          cursor: grab;
          transition: transform 220ms, box-shadow 220ms;
        }
        .fancy-slider:hover::-moz-range-thumb {
          transform: scale(1.15);
          box-shadow:
            0 4px 16px -2px rgba(14, 116, 144, 0.5),
            0 0 0 6px rgba(34, 211, 238, 0.18);
        }
        .fancy-slider:active::-moz-range-thumb {
          cursor: grabbing;
          transform: scale(1.25);
          box-shadow:
            0 4px 20px -2px rgba(14, 116, 144, 0.6),
            0 0 0 8px rgba(34, 211, 238, 0.22);
        }
        .fancy-slider:focus-visible::-webkit-slider-thumb {
          outline: 2px solid #0e7490;
          outline-offset: 4px;
        }
        @media (prefers-reduced-motion: reduce) {
          .fancy-slider::-webkit-slider-thumb,
          .fancy-slider::-moz-range-thumb { transition: none; }
        }
      `}</style>

      {/* ── Page container ────────────────────────────────────────────── */}
      <main className="relative mx-auto w-full max-w-7xl px-4 pb-32 pt-8 sm:px-8 sm:pt-12">
        {/* Top nav */}
        <header className="anim-fade-up mb-8 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#831843]">
            Tamara · Voice Studio
          </p>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/60 px-3 py-1 text-[11px] font-medium text-[#831843] ring-1 ring-inset ring-[#fbcfe8] backdrop-blur">
              Preview · v2
            </span>
            <NextLink
              href="/fr/dashboard-preview"
              className="text-[11px] text-[#831843]/60 underline-offset-4 hover:underline"
            >
              Voir v1 ↗
            </NextLink>
          </div>
        </header>

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Hero card glass — 8/12 */}
          <div
            className="card-hover anim-fade-up relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/55 p-8 shadow-[0_8px_40px_-12px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-12 lg:col-span-8"
            style={{ animationDelay: "60ms" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gradient-to-br from-[#22d3ee]/30 to-[#ec4899]/20 blur-3xl motion-safe:animate-[aurora_15s_ease-in-out_infinite]"
            />

            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#be185d]">
              Votre assistante ·{" "}
              <span className="inline-flex items-center gap-1 text-[#0e7490]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                Live
              </span>
            </p>

            <p
              className="mt-4 break-words bg-gradient-to-br from-[#0e7490] via-[#be185d] to-[#ec4899] bg-clip-text font-display text-5xl font-bold leading-[0.95] tracking-tight tabular-nums text-transparent drop-shadow-[0_2px_24px_rgba(190,24,93,0.18)] sm:text-7xl"
              style={{
                fontFeatureSettings: '"tnum"',
                backgroundSize: "200% 100%",
                animation: "shimmer 8s linear infinite",
              }}
            >
              +33 1 23 45 67 89
            </p>

            <p className="mt-6 max-w-md text-sm leading-relaxed text-[#831843]/70">
              Ta secrétaire vocale prend les appels 24/7. Les changements
              s’appliquent au prochain appel.
            </p>

            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-[#fbcfe8] pt-6">
              <Stat label="Appels aujourd'hui" value="47" tone="cyan" delay={200} />
              <Stat label="Conversion" value="68%" tone="cyan" delay={260} />
              <Stat label="Durée moy." value="2m18" tone="teal" delay={320} />
              <Stat label="RDV pris" value="12" tone="primary" delay={380} />
            </div>
          </div>

          {/* Live status — 4/12 */}
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
                Statut
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22d3ee]/20 px-2.5 py-1 text-[10px] font-semibold text-[#a5f3fc] ring-1 ring-inset ring-[#22d3ee]/40 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-80 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                Live
              </span>
            </div>

            {/* Waveform — alternance blanc/cyan, signature voice tech */}
            <div className="relative flex h-32 items-center justify-center gap-1.5">
              {Array.from({ length: 16 }).map((_, i) => (
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

            <div className="relative space-y-3">
              <Meta label="Voix" value={VOICES.find((v) => v.id === voice)?.name ?? "—"} />
              <Meta label="Langue" value={LANGUAGES.find((l) => l.id === lang)?.name ?? "—"} />
              <Meta label="Vitesse" value={`${personality.vitesse}/10`} />
            </div>
          </div>
        </section>

        {/* ── LIVE TEST ────────────────────────────────────────────────── */}
        <section
          className="card-hover anim-fade-up relative mb-8 overflow-hidden rounded-[2rem] border border-white/50 p-7 shadow-[0_8px_40px_-12px_rgba(14,116,144,0.25)] backdrop-blur-xl sm:p-10"
          style={{
            animationDelay: "220ms",
            backgroundColor: "#ffffff",
            backgroundImage: `
              radial-gradient(at 12% 100%, rgba(34, 211, 238, 0.18) 0px, transparent 50%),
              radial-gradient(at 90% 10%, rgba(236, 72, 153, 0.15) 0px, transparent 55%),
              radial-gradient(at 50% 50%, rgba(255, 255, 255, 0.6) 0px, transparent 60%)
            `,
          }}
        >
          {/* Blob décoratif coin opposé */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#22d3ee]/20 to-transparent blur-3xl"
          />

          {/* Header — titre + statut "prêt" */}
          <div className="relative mb-6 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="mt-1 h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-[#22d3ee] to-[#0e7490]" />
              <div className="min-w-0">
                <h2 className="text-2xl font-extrabold tracking-tight text-[#18181b] sm:text-3xl">
                  Tester en direct
                </h2>
                <p className="mt-1 text-sm text-[#475569]">
                  Lance un appel vocal avec les réglages actuels — y compris non sauvegardés.
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ecfeff] px-3 py-1 text-[11px] font-semibold text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/40">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-70 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
              </span>
              Prêt
            </span>
          </div>

          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[auto_1fr]">
            {/* MIC — bigger, multi-ring */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative flex h-44 w-44 items-center justify-center">
                {/* 3 anneaux ripple en stagger */}
                <span aria-hidden className="ripple-ring" />
                <span aria-hidden className="ripple-ring ripple-ring--2" />
                <span aria-hidden className="ripple-ring ripple-ring--3" />

                <button
                  type="button"
                  aria-label="Démarrer le test vocal"
                  className="group relative inline-flex h-36 w-36 items-center justify-center rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0e7490] text-white shadow-[0_12px_48px_-8px_rgba(14,116,144,0.65)] transition-transform duration-300 hover:scale-[1.06] active:scale-95"
                >
                  {/* Halo cyan voice tech */}
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-full bg-[#22d3ee] opacity-45 blur-2xl motion-safe:animate-pulse"
                  />
                  {/* Inner subtle glow on hover */}
                  <span
                    aria-hidden
                    className="absolute inset-2 rounded-full bg-gradient-to-br from-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  />
                  <svg viewBox="0 0 24 24" fill="none" className="h-14 w-14">
                    <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
                    <path
                      d="M5 11a7 7 0 0 0 14 0M12 18v3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <p className="max-w-[180px] text-center text-xs font-medium leading-relaxed text-[#475569]">
                Clique et parle pour tester ta secrétaire
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[10px] font-medium text-[#475569] ring-1 ring-inset ring-[#e2e8f0]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Session de 40s · gratuit
              </span>
            </div>

            {/* TRANSCRIPT — avec avatars + timestamps */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
                Aperçu de conversation
              </p>
              <div className="space-y-2.5 rounded-2xl border border-[#e2e8f0] bg-white/80 p-4 backdrop-blur">
                <BubbleV2
                  who="assistant"
                  text="Bonjour, c'est Sarah du salon Prestige Coiffure. Comment puis-je vous aider ?"
                  time="14:32"
                  delay={300}
                />
                <BubbleV2
                  who="user"
                  text="Bonjour, je voudrais prendre rendez-vous pour une coupe demain matin."
                  time="14:32"
                  delay={500}
                />
                <BubbleV2
                  who="assistant"
                  text="Bien sûr ! Je vois un créneau à 10h30 avec Laura. Ça vous convient ?"
                  time="14:33"
                  delay={700}
                />
                {/* Indicateur typing — montre que l'assistant "réfléchit" */}
                <div className="anim-fade-up flex items-center gap-2 pt-1" style={{ animationDelay: "900ms" }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0891b2] to-[#0e7490] text-white text-[10px] font-bold ring-2 ring-white">
                    S
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-3 py-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── GRILLE DE TUILES : click pour ouvrir un panel inline ──────── */}
        <section className="mb-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-[#18181b] sm:text-2xl">
                Configuration
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                {activeTile
                  ? "Clique sur une autre tuile pour basculer, ou sur la croix pour fermer."
                  : "Clique sur une tuile pour ouvrir sa configuration."}
              </p>
            </div>
          </div>

          {/* Tile grid — extensible : ajouter une entrée dans TILES + son panel */}
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          >
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
            {/* Placeholder "Bientôt" — illustre l'extensibilité du système */}
            <AddTile delay={300 + TILES.length * 60} />
          </div>

          {/* Zone d'expand — contenu de la tuile active */}
          {activeTile && (
            <div
              key={activeTile}
              className="anim-fade-up mt-5 overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 shadow-[0_4px_24px_-8px_rgba(190,24,93,0.15)] backdrop-blur-xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-6 py-4 sm:px-8">
                <div className="flex items-center gap-3 min-w-0">
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
                  aria-label="Fermer"
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
                    voice={voice}
                    setVoice={setVoice}
                    personality={personality}
                    setPersonality={setPersonality}
                  />
                )}
                {activeTile === "persona" && (
                  <PersonaPanel
                    inheritMode={inheritMode}
                    setInheritMode={setInheritMode}
                    lang={lang}
                    setLang={setLang}
                    greeting={greeting}
                    setGreeting={setGreeting}
                    instructions={instructions}
                    setInstructions={setInstructions}
                  />
                )}
                {activeTile === "notifs" && (
                  <NotifsPanel
                    notifs={notifs}
                    setNotifs={setNotifs}
                    notifValues={notifValues}
                    setNotifValues={setNotifValues}
                  />
                )}
              </div>
            </div>
          )}
        </section>

      </main>

      {/* Floating save dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-6">
        <div
          className="pointer-events-auto flex items-center gap-4 rounded-full border border-white/50 bg-white/85 px-2 py-2 pl-5 shadow-[0_12px_40px_-8px_rgba(190,24,93,0.25)] backdrop-blur-xl anim-fade-up"
          style={{ animationDelay: "700ms" }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-[#831843]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
            À jour
          </span>
          <button
            type="button"
            className="group rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-5 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95"
          >
            <span className="inline-flex items-center gap-1.5">
              Sauvegarder
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────

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
        {active && (
          <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-[bounce-in_0.3s_ease-out]" />
        )}
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
  delay = 0,
}: {
  channel: NotifChannel;
  label: string;
  icon: React.ReactNode;
  color: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChangeValue: (v: string) => void;
  placeholder: string;
  inputType: string;
  delay?: number;
}) {
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent">("idle");

  const handleTest = async () => {
    if (!on || testStatus !== "idle") return;
    setTestStatus("sending");
    // Simule l'envoi (800ms) puis état "sent" pendant 2s avant retour idle.
    await new Promise((r) => setTimeout(r, 800));
    setTestStatus("sent");
    setTimeout(() => setTestStatus("idle"), 2200);
  };
  return (
    <div
      className={`anim-bounce-in flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : "border-[#e2e8f0] bg-white/50"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on ? color : "#f1f5f9",
              color: on ? "white" : "#94a3b8",
              boxShadow: on ? `0 4px 16px -4px ${color}66` : "none",
            }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#18181b]">{label}</p>
            <p className="text-[11px] text-[#475569]">
              {on ? (
                <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                  Actif
                </span>
              ) : (
                "Désactivé"
              )}
            </p>
          </div>
        </div>

        {/* Toggle switch — flex layout (centrage auto), padding 2px, slide via translate */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? "Désactiver" : "Activer"} ${label}`}
          onClick={() => onToggle(!on)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 ${
            on
              ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
              : "bg-[#cbd5e1]"
          }`}
        >
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: on ? "translateX(20px)" : "translateX(0)" }}
          />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={!on}
          className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={!on || testStatus !== "idle"}
          aria-label={`Envoyer un message test sur ${label}`}
          className={`group inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            testStatus === "sent"
              ? "border-[#22d3ee]/40 bg-[#ecfeff] text-[#0e7490]"
              : "border-[#0e7490]/30 bg-white text-[#0e7490] hover:-translate-y-0.5 hover:border-[#0e7490] hover:bg-[#ecfeff] hover:shadow-sm"
          }`}
        >
          {testStatus === "sending" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 motion-safe:animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Envoi…
            </>
          ) : testStatus === "sent" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 motion-safe:animate-[bounce-in_0.4s_ease-out]">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Envoyé
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Tester
            </>
          )}
        </button>
      </div>
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
        <p className="mt-0.5 font-mono text-xs font-semibold text-[#18181b]">
          {value}
        </p>
      </div>
      {lock && (
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#0e7490]"
          title="Verrouillé"
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
  delay = 0,
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "cyan" | "teal";
  delay?: number;
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
    <div className="min-w-0 anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#831843]/60">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${valueColor}`}>
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
      <p className="font-mono text-sm font-medium">{value}</p>
    </div>
  );
}

// ─── Tiles ──────────────────────────────────────────────────────────────

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
      {/* Glow accent en fond quand actif */}
      {active && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tile.accent} opacity-15 blur-2xl`}
        />
      )}

      {/* Icon top-left */}
      <span
        className={`relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tile.accent} text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3`}
      >
        {tile.icon}
      </span>

      {/* Title + tagline + summary bottom */}
      <div className="relative min-w-0 w-full">
        <p className="text-base font-extrabold tracking-tight text-[#18181b]">
          {tile.label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug italic text-[#0e7490]">
          {tile.tagline}
        </p>
        <p className="mt-1 truncate text-[10px] text-[#475569]">
          {tile.summary}
        </p>
      </div>

      {/* Indicator actif (petit dot) */}
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
  return (
    <div
      className="anim-bounce-in flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/30 p-4 text-[#94a3b8] backdrop-blur"
      style={{ animationDelay: `${delay}ms` }}
      title="Tuiles supplémentaires à venir"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e1]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <p className="text-[11px] font-medium text-center">
        Bientôt
      </p>
    </div>
  );
}

// ─── Panels (contenu de chaque tuile expand) ────────────────────────────

function VoicePanel({
  voice,
  setVoice,
  personality,
  setPersonality,
}: {
  voice: string;
  setVoice: (v: string) => void;
  personality: Personality;
  setPersonality: React.Dispatch<React.SetStateAction<Personality>>;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* 1. Modèle + voice picker (top) */}
      <div>
        <Tag label="Modèle" value="gpt-realtime-mini" lock />

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Voix sélectionnée
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {VOICES.map((v) => {
              const active = v.id === voice;
              const isF = v.gender === "f";
              // Gradient actif : rose pour féminine, cyan/teal pour masculine.
              const activeGradient = isF
                ? "from-[#be185d] to-[#ec4899]"
                : "from-[#06b6d4] to-[#0e7490]";
              // Border hover : tinted gender pour signaler visuellement avant click.
              const inactiveHover = isF
                ? "hover:border-[#be185d]/40"
                : "hover:border-[#0e7490]/40";
              // Play button bg + couleur icon en mode inactif.
              const inactivePlay = isF
                ? "bg-[#fdf2f8] text-[#be185d]"
                : "bg-[#ecfeff] text-[#0e7490]";
              // Genre badge en mode inactif (couleur du label).
              const inactiveBadge = isF
                ? "text-[#be185d] bg-[#fdf2f8] ring-[#fbcfe8]"
                : "text-[#0e7490] bg-[#ecfeff] ring-[#22d3ee]/40";

              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoice(v.id)}
                  className={`group flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-300 ${
                    active
                      ? `border-transparent bg-gradient-to-br ${activeGradient} text-white shadow-md`
                      : `border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:bg-white hover:shadow-md ${inactiveHover}`
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{v.name}</p>
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
                      {GENDER_LABEL[v.gender]} · {v.desc}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                      active
                        ? "bg-white/20 text-white scale-110"
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

          {/* Légende couleurs genre — discrète, sous la grille */}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-[#475569]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899]" />
              Féminine
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0e7490]" />
              Masculine
            </span>
          </div>
        </div>
      </div>

      {/* 2. Personnalité — 9 sliders 1-10 en grid 2 cols desktop */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/40 to-white/60 p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Personnalité de la voix
          </p>
          <button
            type="button"
            onClick={() => setPersonality(PERSONALITY_DEFAULT)}
            className="text-[10px] font-medium text-[#475569] underline-offset-4 hover:underline"
          >
            Réinitialiser
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
          {PERSONALITY_SLIDERS.map((s) => (
            <PersonalitySlider
              key={s.key}
              label={s.label}
              value={personality[s.key]}
              onChange={(v) =>
                setPersonality((prev) => ({ ...prev, [s.key]: v }))
              }
              minLabel={s.min}
              maxLabel={s.max}
              icon={s.icon}
              animClass={s.anim}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Slider 1-10 custom : track gradient cyan→teal qui se remplit jusqu'à la
 * valeur, fond muted pour la partie non-atteinte. Thumb gradient avec glow
 * au hover/active. Voir `.fancy-slider` dans le <style> embedded.
 */
function PersonalitySlider({
  label,
  value,
  onChange,
  minLabel,
  maxLabel,
  icon,
  animClass,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
  icon?: React.ReactNode;
  animClass?: string;
}) {
  // Pourcentage de remplissage (1→0%, 10→100%). Construit le gradient inline
  // qui matérialise la portion "fillée" jusqu'au thumb.
  const pct = ((value - 1) / 9) * 100;
  const trackGradient = `linear-gradient(to right, #0891b2 0%, #22d3ee ${pct}%, #e0f7fa ${pct}%, #cffafe 100%)`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#ecfeff] to-[#cffafe] text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/30 ${animClass ?? ""}`}
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                {icon}
              </svg>
            </span>
          )}
          <p className="truncate text-sm font-semibold text-[#18181b]">{label}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#ecfeff] to-[#cffafe] px-2 py-0.5 font-mono text-[11px] font-bold text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/40 shadow-sm">
          {value}
          <span className="text-[#0e7490]/50">/10</span>
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value} sur 10 — ${value <= 3 ? minLabel : value >= 8 ? maxLabel : "intermédiaire"}`}
        className="fancy-slider"
        style={{ background: trackGradient }}
      />
      <div className="mt-2 flex justify-between gap-2 text-[10px] leading-tight text-[#475569]">
        <span
          className={`max-w-[45%] transition-colors ${
            value <= 3 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {minLabel}
        </span>
        <span
          className={`max-w-[45%] text-right transition-colors ${
            value >= 8 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {maxLabel}
        </span>
      </div>
    </div>
  );
}

function PersonaPanel({
  inheritMode,
  setInheritMode,
  lang,
  setLang,
  greeting,
  setGreeting,
  instructions,
  setInstructions,
}: {
  inheritMode: "inherit" | "custom";
  setInheritMode: (v: "inherit" | "custom") => void;
  lang: string;
  setLang: (v: string) => void;
  greeting: string;
  setGreeting: (v: string) => void;
  instructions: string;
  setInstructions: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Mode radio en haut */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/50 to-white/30 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          Mode de configuration
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <RadioCard
            active={inheritMode === "inherit"}
            onClick={() => setInheritMode("inherit")}
            title="Hériter du prompt admin"
            desc="Reçoit les directives globales de ton plan (Pro)."
          />
          <RadioCard
            active={inheritMode === "custom"}
            onClick={() => setInheritMode("custom")}
            title="Personnalisé"
            desc="Utilise uniquement ta persona ci-dessous."
          />
        </div>
      </div>

      {/* Langue */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          Langue principale
        </p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => {
            const active = l.id === lang;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLang(l.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "border-transparent bg-[#18181b] text-white shadow-md"
                    : "border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:shadow-sm"
                }`}
              >
                <span className="font-mono text-[10px] opacity-70">{l.flag}</span>
                {l.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Greeting */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          Phrase d’accueil
        </p>
        <input
          type="text"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">
          Première phrase prononcée à chaque appel. Garde-la courte.
        </p>
      </div>

      {/* Instructions */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          Instructions
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={9}
          disabled={inheritMode === "inherit"}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-3 font-mono text-xs leading-relaxed text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {inheritMode === "inherit"
            ? "Désactivé : les directives admin sont appliquées. Bascule sur « Personnalisé » pour éditer."
            : "Markdown supporté. Décrivez identité, horaires, prestations, ton, workflows."}
        </p>
      </div>
    </div>
  );
}

function NotifsPanel({
  notifs,
  setNotifs,
  notifValues,
  setNotifValues,
}: {
  notifs: Record<NotifChannel, boolean>;
  setNotifs: React.Dispatch<React.SetStateAction<Record<NotifChannel, boolean>>>;
  notifValues: Record<NotifChannel, string>;
  setNotifValues: React.Dispatch<React.SetStateAction<Record<NotifChannel, string>>>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <NotifChannelCard
        channel="whatsapp"
        label="WhatsApp"
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.81 11.81 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413Z" />
          </svg>
        }
        color="#25D366"
        on={notifs.whatsapp}
        onToggle={(v) => setNotifs((p) => ({ ...p, whatsapp: v }))}
        value={notifValues.whatsapp}
        onChangeValue={(v) => setNotifValues((p) => ({ ...p, whatsapp: v }))}
        placeholder="+972..."
        inputType="tel"
      />
      <NotifChannelCard
        channel="sms"
        label="SMS"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        }
        color="#3B82F6"
        on={notifs.sms}
        onToggle={(v) => setNotifs((p) => ({ ...p, sms: v }))}
        value={notifValues.sms}
        onChangeValue={(v) => setNotifValues((p) => ({ ...p, sms: v }))}
        placeholder="+972..."
        inputType="tel"
      />
      <NotifChannelCard
        channel="email"
        label="Email"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 6-10 7L2 6" />
          </svg>
        }
        color="#0e7490"
        on={notifs.email}
        onToggle={(v) => setNotifs((p) => ({ ...p, email: v }))}
        value={notifValues.email}
        onChangeValue={(v) => setNotifValues((p) => ({ ...p, email: v }))}
        placeholder="contact@..."
        inputType="email"
      />
    </div>
  );
}

/**
 * Bubble v2 — avec avatar circulaire à gauche/droite + timestamp au-dessus.
 * Utilisée dans la section "Tester en direct" pour rendre la convo plus vivante.
 */
function BubbleV2({
  who,
  text,
  time,
  delay = 0,
}: {
  who: "user" | "assistant";
  text: string;
  time: string;
  delay?: number;
}) {
  const isUser = who === "user";
  return (
    <div
      className={`anim-fade-up flex items-end gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Avatar */}
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-white ${
          isUser
            ? "bg-gradient-to-br from-[#be185d] to-[#9d174d]"
            : "bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
        }`}
        aria-hidden
      >
        {isUser ? "M" : "S"}
      </span>

      <div className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}>
        <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-[#94a3b8]">
          {isUser ? "Marie" : "Sarah"} · {time}
        </span>
        <div
          className={`mt-0.5 rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${
            isUser
              ? "bg-gradient-to-br from-[#be185d] to-[#9d174d] text-white rounded-br-md"
              : "bg-gradient-to-br from-[#ecfeff] to-white text-[#18181b] ring-1 ring-inset ring-[#22d3ee]/30 rounded-bl-md"
          }`}
        >
          {text}
        </div>
      </div>
    </div>
  );
}
