"use client";

/**
 * Channels panel — ADMIN-ONLY WhatsApp activation tile (POC stub: opens the
 * supplier's WhatsApp sender docs, no real provisioning). Loaded with
 * next/dynamic from channels-panel.tsx for admins only, so the supplier
 * link never reaches a tenant's browser.
 */

import type { Translator } from "./types";
import { WhatsappTile } from "./channels-whatsapp-tile";

const TWILIO_WHATSAPP_DOCS_URL =
  "https://www.twilio.com/docs/whatsapp/self-sign-up";

export function ChannelsWhatsappAdmin({
  hasWhatsapp,
  t,
}: {
  hasWhatsapp: boolean;
  t: Translator;
}) {
  const openTwilioDocs = () => {
    window.open(TWILIO_WHATSAPP_DOCS_URL, "_blank", "noopener,noreferrer");
  };
  return (
    <WhatsappTile active={hasWhatsapp} t={t}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <p className="text-[13px] leading-relaxed text-[#475569]">
          {t("channelsWhatsappExplainer")}
        </p>
        <button
          type="button"
          onClick={openTwilioDocs}
          aria-label={t("channelsActivateWhatsapp")}
          className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-xl bg-gradient-to-br from-[#128C7E] to-[#075E54] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#128C7E] focus-visible:ring-offset-2 active:scale-95"
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
    </WhatsappTile>
  );
}
