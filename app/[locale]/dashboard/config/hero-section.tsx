"use client";

/**
 * Section hero du /dashboard : numéro principal du tenant (or "no number
 * yet" with a link to the checklist's onboarding step), stats du jour/mois, et card statut cyan "live" avec
 * waveform animée + voix/langue/plan courants.
 *
 * Rendu en haut de ConfigForm (config-form.tsx) — span 2 colonnes en xl+.
 */

import { useLocale, useTranslations } from "next-intl";

import { Meta, Stat } from "./shared-ui";
import type { DashboardStats } from "./types";
import { splitDuration } from "./stat-format";
import { formatPhone } from "@/lib/format-phone";
import { useVoiceLabel } from "@/lib/use-voice-label";
import { Link } from "@/i18n/navigation";

export function HeroSection({
  primaryPhone,
  stats,
  lastUpdatedLabel,
  planLabel,
  voice,
  currentLangLabel,
}: {
  primaryPhone: string | null;
  stats?: DashboardStats;
  lastUpdatedLabel: string;
  planLabel: string;
  /** Voix active (form.voice) affichée dans la card statut. */
  voice: string;
  /** Label traduit de la langue principale (ex. "Français"). */
  currentLangLabel: string;
}) {
  const t = useTranslations("DashboardConfig");
  const tSetup = useTranslations("DashboardSetup");
  const voiceLabel = useVoiceLabel();
  const locale = useLocale();
  // `rdvSince` only exists once stats come from book_success events (and
  // real durations). Until then the figures are summary-regex counts and
  // transcript-length estimates, and the labels say so.
  const measured = stats?.rdvSince !== undefined;
  // Number + unit stats go through ICU messages (never "n min" concatenated):
  // each locale orders the number and its unit itself, so Hebrew reads
  // "0 דק׳" instead of the bidi-reordered "min 0".
  const approx = (value: string, estimated: boolean) =>
    estimated ? t("statApproxValue", { value }) : value;
  const avg = stats ? splitDuration(stats.avgSeconds) : null;
  const sinceFmt = new Intl.DateTimeFormat(
    locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR",
    { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" },
  );

  return (
    <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12 xl:col-span-2">
      <div
        className="card-hover anim-fade-up relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/55 p-7 shadow-[0_8px_40px_-12px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-10 lg:col-span-8"
        style={{ animationDelay: "60ms" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gradient-to-br from-[#f472b6]/30 to-[#ec4899]/20 blur-3xl motion-safe:animate-[aurora_15s_ease-in-out_infinite]"
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
            className="mt-4 whitespace-nowrap bg-gradient-to-r from-[#be185d] via-[#db2777] to-[#f472b6] bg-clip-text font-display text-[clamp(1.5rem,7.5vw,2.25rem)] font-bold leading-[0.95] tracking-tight tabular-nums text-transparent drop-shadow-[0_2px_24px_rgba(190,24,93,0.18)] sm:text-6xl ltr:text-left rtl:text-right"
            style={{
              fontFeatureSettings: '"tnum"',
              backgroundSize: "200% 100%",
              animation: "shimmer 8s linear infinite",
            }}
          >
            {formatPhone(primaryPhone)}
          </p>
        ) : (
          // No number yet. Provisioning is a single synchronous request (it
          // either inserts the phone_numbers row or rolls back), so there is
          // no "pending" state to show: no row always means "no number yet".
          // The link reuses the checklist's wording and target, so there is
          // still one "get a number" call to action.
          <p className="mt-4 text-base text-[#475569]">
            {t("heroNoNumber")} ·{" "}
            <Link
              href="/onboarding"
              className="font-semibold text-[#be185d] underline-offset-4 hover:underline focus-visible:underline"
            >
              {tSetup("numberCta")}
            </Link>
          </p>
        )}

        {stats && (
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-[#fbcfe8]/60 pt-6">
            <Stat
              label={t("wowStatCallsToday")}
              value={stats.callsToday.toString()}
              tone="cyan"
            />
            <Stat
              label={t(measured ? "statMinutesMonth" : "wowStatMinutesMonth")}
              value={approx(t("statMinutesValue", { count: stats.minutesThisMonth }), !measured)}
              tone="cyan"
            />
            <Stat
              label={t(measured ? "statBookingRate" : "wowStatConversion")}
              value={t("statPercentValue", { rate: stats.conversion })}
              tone="teal"
            />
            <Stat
              label={t(measured ? "statAvgDuration" : "wowStatAvgDuration")}
              value={
                avg
                  ? approx(t("statDurationValue", avg), !measured)
                  : "—"
              }
              tone="teal"
            />
            <Stat
              label={t(measured ? "statBookings" : "wowStatRdv")}
              value={stats.rdv.toString()}
              tone="primary"
              hint={
                !measured
                  ? undefined
                  : stats.rdvSince
                    ? t("statBookingsSince", {
                        date: sinceFmt.format(
                          new Date(`${stats.rdvSince}T00:00:00Z`),
                        ),
                      })
                    : t("statBookingsTrackedFromNow")
              }
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
        className="card-hover anim-fade-up relative flex flex-col gap-5 overflow-hidden rounded-[2rem] border border-white/40 bg-gradient-to-br from-[#0e7490] via-[#0e7490] to-[#155e75] p-7 text-white shadow-[0_8px_40px_-12px_rgba(14,116,144,0.4)] lg:col-span-4"
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
          <Meta label={t("heroVoiceLabel")} value={voiceLabel(voice)} />
          <Meta label={t("heroLanguageLabel")} value={currentLangLabel} />
          <Meta label={t("wowPlanLabel")} value={planLabel || "—"} />
        </div>
      </div>
    </section>
  );
}
