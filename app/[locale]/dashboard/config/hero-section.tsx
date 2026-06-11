"use client";

/**
 * Section hero du /dashboard : numéro principal du tenant (ou CTA onboarding
 * si aucun numéro), stats du jour/mois, et card statut cyan "live" avec
 * waveform animée + voix/langue/plan courants.
 *
 * Rendu en haut de ConfigForm (config-form.tsx) — span 2 colonnes en xl+.
 */

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { Meta, Stat } from "./shared-ui";
import type { DashboardStats } from "./types";

export function HeroSection({
  primaryPhone,
  asUserId,
  stats,
  lastUpdatedLabel,
  planLabel,
  voice,
  currentLangLabel,
}: {
  primaryPhone: string | null;
  /** Présent en mode "admin agissant sur un tenant" → masque le CTA onboarding. */
  asUserId?: string;
  stats?: DashboardStats;
  lastUpdatedLabel: string;
  planLabel: string;
  /** Voix active (form.voice) affichée dans la card statut. */
  voice: string;
  /** Label traduit de la langue principale (ex. "Français"). */
  currentLangLabel: string;
}) {
  const t = useTranslations("DashboardConfig");

  return (
    <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12 xl:col-span-2">
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
            dir="ltr"
            className="mt-4 break-words bg-gradient-to-r from-[#0e7490] via-[#be185d] to-[#ec4899] bg-clip-text font-display text-4xl font-bold leading-[0.95] tracking-tight tabular-nums text-transparent drop-shadow-[0_2px_24px_rgba(190,24,93,0.18)] sm:text-6xl ltr:text-left rtl:text-right"
            style={{
              fontFeatureSettings: '"tnum"',
              backgroundSize: "200% 100%",
              animation: "shimmer 8s linear infinite",
            }}
          >
            {primaryPhone}
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-base text-[#475569]">{t("heroNoPhone")}</p>
            {/* Filet de sécurité : un tenant sans numéro (signup Google
                arrivé sur le dashboard, onboarding interrompu…) peut
                relancer le wizard. Masqué en vue admin (asUserId). */}
            {!asUserId && (
              <Link
                href="/onboarding"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#0e7490] to-[#be185d] px-4 py-2 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.99]"
              >
                {t("heroGetNumber")}
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path
                    d="M5 12h14M13 5l7 7-7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            )}
          </div>
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
          <Meta label={t("heroVoiceLabel")} value={voice} />
          <Meta label={t("heroLanguageLabel")} value={currentLangLabel} />
          <Meta label={t("wowPlanLabel")} value={planLabel || "—"} />
        </div>
      </div>
    </section>
  );
}
