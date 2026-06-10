"use client";

/**
 * Tuile "Voix" : picker du modèle (admin only), picker de voix OpenAI
 * Realtime (avec genre F/M et descriptions traduites), slider de réduction
 * de bruit (Quail VF 2.1 L) et les 9 sliders de personnalité.
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `voice`).
 */

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { cap } from "./formatting";
import { PERSONALITY_SLIDER_META } from "./personality-constants";
import { AdminBadge, PersonalitySlider, Tag } from "./shared-ui";
import type { FormState, FormUpdater } from "./types";

type Gender = "f" | "m";

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

export function VoicePanel({
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
  update: FormUpdater;
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
      {/* Modèle — picker dropdown réservé admin. Le tenant voit un Tag
       *  verrouillé (lock) à la place. Badge ADMIN pour signaler que
       *  ce contrôle n'apparaît PAS sur /dashboard du tenant. */}
      {isAdmin ? (
        <div>
          <div className="mb-1.5 flex items-baseline gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
              {t("modelLabel")}
            </p>
            <AdminBadge size="xs" />
          </div>
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
