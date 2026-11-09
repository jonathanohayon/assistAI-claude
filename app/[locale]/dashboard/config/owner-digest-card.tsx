"use client";

/**
 * Owner daily digest (lib/owner-digest-run.ts): every morning on WhatsApp,
 * yesterday's calls, bookings, messages and transfers. Sent to the owner
 * WhatsApp number; nothing is sent without one, or on days with no calls.
 *
 * Used by: notifs-panel.tsx, after the J-1 reminder card.
 */

import type { FormState, FormUpdater, Translator } from "./types";

export function OwnerDigestCard({
  form,
  update,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  t: Translator;
}) {
  const on = form.ownerDigestEnabled !== false;
  const to = form.ownerWhatsapp.trim();

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on ? "#25D366" : "#f1f5f9",
              color: on ? "white" : "#94a3b8",
              boxShadow: on ? "0 4px 16px -4px #25D36666" : "none",
            }}
          >
            {/* Sunrise: a morning summary */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M17 18a5 5 0 0 0-10 0" />
              <path d="M12 2v7M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M8 6l4-4 4 4" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#18181b]">{t("digestTitle")}</p>
            <p className="text-[11px] text-[#475569]">
              {on ? (
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
          dir="ltr"
          aria-checked={on}
          aria-label={t("wowToggleAria", {
            action: on ? t("wowToggleDisable") : t("wowToggleEnable"),
            label: t("digestTitle"),
          })}
          onClick={() => update("ownerDigestEnabled", !on)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 ${
            on
              ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
              : "bg-[#94a3b8] hover:bg-[#64748b]"
          }`}
        >
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: on ? "translateX(20px)" : "translateX(0)" }}
          />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[#475569]">{t("digestHint")}</p>
      {on &&
        (to ? (
          <p className="text-[11px] text-[#475569]">
            {t("digestSentTo")}{" "}
            <span dir="ltr" className="whitespace-nowrap font-mono font-semibold text-[#18181b]">
              {to}
            </span>
          </p>
        ) : (
          <p className="rounded-xl bg-[#fffbeb] px-3 py-2 text-[11px] text-[#92400e]">{t("digestNoNumber")}</p>
        ))}
    </div>
  );
}
