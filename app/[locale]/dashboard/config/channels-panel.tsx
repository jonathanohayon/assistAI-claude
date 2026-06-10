"use client";

/**
 * Tuile "Canaux" : liste les numéros du tenant (PSTN vs WhatsApp) avec un
 * badge par canal et propose un parcours d'activation WhatsApp (POC stub —
 * ouvre la doc Twilio WhatsApp Sender, pas de provisioning réel). Scopé via
 * asUserId pour la vue admin sur un tenant.
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `channels`).
 */

import { useEffect, useState } from "react";

import { EmptyState } from "./shared-ui";
import type { ChannelNumber, Translator } from "./types";

const TWILIO_WHATSAPP_DOCS_URL =
  "https://www.twilio.com/docs/whatsapp/self-sign-up";

export function ChannelsPanel({
  t,
  asUserId,
}: {
  t: Translator;
  asUserId?: string;
}) {
  const [numbers, setNumbers] = useState<ChannelNumber[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = asUserId
      ? `/api/dashboard/channels?asUserId=${encodeURIComponent(asUserId)}`
      : "/api/dashboard/channels";
    fetch(url)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("fetch failed")),
      )
      .then((data: { numbers?: ChannelNumber[] }) => {
        if (!cancelled) setNumbers(data.numbers ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asUserId]);

  const hasWhatsapp = (numbers ?? []).some((n) => n.channel === "whatsapp");

  const openTwilioDocs = () => {
    window.open(TWILIO_WHATSAPP_DOCS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Liste des numéros ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <header className="border-b border-[#e2e8f0]/70 bg-white/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <div>
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("channelsNumbersTitle")}
              </h4>
              <p className="text-[11px] text-[#64748b]">
                {t("channelsNumbersSubtitle")}
              </p>
            </div>
          </div>
        </header>

        <div className="px-5 py-5">
          {numbers === null && !loadError ? (
            <p className="py-6 text-center text-sm text-[#64748b]">
              {t("channelsLoading")}
            </p>
          ) : (numbers ?? []).length === 0 ? (
            <EmptyState
              icon={
                <>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </>
              }
              title={t("channelsEmptyTitle")}
              body={t("channelsEmptyBody")}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {(numbers ?? []).map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc]/60 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ChannelBadge channel={n.channel} t={t} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#18181b]">
                        {n.label || t("channelsNoLabel")}
                      </p>
                      <p
                        dir="ltr"
                        className="truncate font-mono text-[13px] text-[#475569] ltr:text-left rtl:text-right"
                      >
                        {n.phoneNumber}
                      </p>
                    </div>
                  </div>
                  {n.countryCode && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#64748b] ring-1 ring-inset ring-[#e2e8f0]">
                      {n.countryCode}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Activation WhatsApp (POC stub) ────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-[#25D366]/30 bg-gradient-to-br from-[#25D366]/8 to-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#25D366]/20 bg-white/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.16c-.25.7-1.44 1.34-1.99 1.39-.51.05-1.16.07-1.87-.12-.43-.11-.99-.3-1.7-.61-2.99-1.29-4.94-4.3-5.09-4.5-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.37 1.46.3.15.47.12.65-.07.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.42z" />
              </svg>
            </span>
            <div>
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("channelsWhatsappTitle")}
              </h4>
              <p className="text-[11px] text-[#64748b]">
                {t("channelsWhatsappSubtitle")}
              </p>
            </div>
          </div>
          <StatusPill active={hasWhatsapp} t={t} />
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-[13px] leading-relaxed text-[#475569]">
            {t("channelsWhatsappExplainer")}
          </p>
          <button
            type="button"
            onClick={openTwilioDocs}
            aria-label={t("channelsActivateWhatsapp")}
            className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#128C7E] focus-visible:ring-offset-2 active:scale-95"
          >
            {t("channelsActivateWhatsapp")}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 rtl:-scale-x-100"
              aria-hidden
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  );
}

/** Badge canal — vert WhatsApp (icône bulle) ou neutre PSTN (icône combiné).
 *  Icônes inline SVG, jamais d'emoji. */
function ChannelBadge({
  channel,
  t,
}: {
  channel: "pstn" | "whatsapp";
  t: Translator;
}) {
  if (channel === "whatsapp") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#25D366]/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#128C7E] ring-1 ring-inset ring-[#25D366]/30">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.16c-.25.7-1.44 1.34-1.99 1.39-.51.05-1.16.07-1.87-.12-.43-.11-.99-.3-1.7-.61-2.99-1.29-4.94-4.3-5.09-4.5-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.37 1.46.3.15.47.12.65-.07.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.42z" />
        </svg>
        {t("channelsBadgeWhatsapp")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0e7490]/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0e7490] ring-1 ring-inset ring-[#0e7490]/25">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      {t("channelsBadgePstn")}
    </span>
  );
}

/** Pastille de statut WhatsApp — vert "Active" si au moins un numéro WhatsApp
 *  est rattaché, ambre "Pending verification" sinon (POC). */
function StatusPill({
  active,
  t,
}: {
  active: boolean;
  t: Translator;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${
        active
          ? "bg-[#25D366]/12 text-[#128C7E] ring-[#25D366]/30"
          : "bg-[#f59e0b]/12 text-[#b45309] ring-[#f59e0b]/30"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-[#25D366]" : "bg-[#f59e0b] motion-safe:animate-pulse"
        }`}
      />
      {active ? t("channelsStatusActive") : t("channelsStatusPending")}
    </span>
  );
}
