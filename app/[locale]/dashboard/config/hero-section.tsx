"use client";

/**
 * Section hero du /dashboard : numéro principal du tenant (or "no number
 * yet" with a link to the checklist's onboarding step), stats du jour/mois, et card statut cyan avec
 * waveform + voix/langue/plan courants. The status (live / to activate /
 * to check) comes from the server's stats.agentState, see hero-live-state.ts.
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
import { supportHref } from "@/components/marketing/SupportFab";
import { heroLiveState } from "./hero-live-state";

// The status line's action link keeps a 44 px touch target.
const STATUS_LINK =
  "inline-flex min-h-11 items-center font-semibold text-[#be185d] underline-offset-4 hover:underline focus-visible:underline";
// Same, inside wrapping text: 12 px of padding above and below (26 + 24 =
// 50 px tall hit area) cancelled by negative margins, so the link doesn't
// stretch the line it sits on.
const INLINE_STATUS_LINK =
  "-my-3 inline-block py-3 font-semibold text-[#be185d] underline-offset-4 hover:underline focus-visible:underline";

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
  const tSupport = useTranslations("Support");
  const voiceLabel = useVoiceLabel();
  const locale = useLocale();
  // The server's agentState decides; without it, the number-based rule
  // (no number = no calls). Never "to check" unless the server said so.
  const liveState = heroLiveState({ agentState: stats?.agentState, primaryPhone });
  const live = liveState.live;
  const attention = liveState.status === "attention";
  // Amber only when the owner can act; "offline" (our side) stays grey.
  const warning = liveState.tone === "warning";
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
          <span
            className={`inline-flex items-center gap-1 ${live ? "text-[#0e7490]" : warning ? "text-[#92400e]" : "text-[#475569]"}`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {live && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-70 motion-safe:animate-ping" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? "bg-[#22d3ee]" : warning ? "bg-[#f59e0b]" : "bg-[#94a3b8]"}`}
              />
            </span>
            {t(liveState.eyebrowStatusKey)}
          </span>
        </p>

        {primaryPhone && (
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
        )}

        {liveState.action === "get_number" && (
          // No number yet. Provisioning is a single synchronous request (it
          // either inserts the phone_numbers row or rolls back), so there is
          // no "pending" state to show: no row always means "no number yet".
          // The link reuses the checklist's wording and target, so there is
          // still one "get a number" call to action.
          <p className="mt-4 text-base text-[#475569]">
            {t("heroNoNumber")} ·{" "}
            <Link href="/onboarding" className={STATUS_LINK}>
              {tSetup("numberCta")}
            </Link>
          </p>
        )}

        {attention && liveState.lineKey && (
          // The agent has a number but won't answer: one plain line and, when
          // there is one, the thing the owner can do about it. No technical
          // detail. The icon sits inline with the text so a wrapped line keeps
          // it at the start (left in LTR, right in RTL).
          <p
            className={`mt-3 text-base leading-relaxed ${warning ? "text-[#92400e]" : "text-[#475569]"}`}
          >
            {warning && (
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                fill="currentColor"
                className="me-1.5 inline-block h-4 w-4 align-[-2px] text-[#b45309]"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {t(liveState.lineKey)}{" "}
            {liveState.action === "plans" && (
              <Link href="/dashboard/billing" className={INLINE_STATUS_LINK}>
                {t("heroSeePlans")}
              </Link>
            )}
            {liveState.action === "support" && (
              <a
                href={supportHref(tSupport("waGreeting"))}
                target="_blank"
                rel="noopener noreferrer"
                className={INLINE_STATUS_LINK}
              >
                {t("heroContactTeam")}
              </a>
            )}
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
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset backdrop-blur ${
              live
                ? "bg-[#22d3ee]/20 text-[#a5f3fc] ring-[#22d3ee]/40"
                : warning
                  ? "bg-[#fde68a] text-[#78350f] ring-[#f59e0b]/60"
                  : "bg-black/20 text-white ring-white/30"
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {live && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-80 motion-safe:animate-ping" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? "bg-[#22d3ee]" : warning ? "bg-[#b45309]" : "bg-white/60"}`}
              />
            </span>
            {t(liveState.badgeKey)}
          </span>
        </div>

        {/* Waveform alterné blanc/cyan. It only moves while the agent is
         *  live: a moving waveform would suggest calls that can't happen. */}
        <div
          aria-hidden
          className={`relative flex h-28 items-center justify-center gap-1.5 ${live ? "" : "opacity-40"}`}
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className={`w-1 rounded-full ${live ? "motion-safe:animate-[wave_1.2s_ease-in-out_infinite]" : ""}`}
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
