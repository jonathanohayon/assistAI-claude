"use client";

/**
 * Channels panel: the WhatsApp tile's frame (header + status pill), shared
 * by the tenant tile (channels-panel.tsx, shown only once WhatsApp is
 * usable) and the admin activation tile (channels-whatsapp-admin.tsx).
 * No supplier name in here: it ships to tenants.
 */

import type { ReactNode } from "react";

import type { Translator } from "./types";

export function WhatsappTile({
  active,
  t,
  children,
}: {
  active: boolean;
  t: Translator;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#25D366]/30 bg-gradient-to-br from-[#25D366]/8 to-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#25D366]/20 bg-white/60 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#128C7E] to-[#075E54] text-white shadow-sm">
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
        <StatusPill active={active} t={t} />
      </header>
      {children}
    </section>
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
