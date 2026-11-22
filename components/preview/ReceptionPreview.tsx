"use client";

/**
 * Réception, not owned (F2): the REAL reception overview (the hero with its
 * number and figures, the notifications and channels tiles) over sample
 * data, beside a STATIC live test mock (LiveTestPreview: never a session).
 * Read-only: the tiles are disabled and nothing is fetched or saved. The
 * account's own settings are not read: everything shown is a sample.
 */

import { useLocale, useTranslations } from "next-intl";

import { CONFIG_FORM_CSS } from "@/app/[locale]/dashboard/config/config-form-css";
import { HeroSection } from "@/app/[locale]/dashboard/config/hero-section";
import { GRID_TWO, TILE_ROW_SIZE_TWO } from "@/app/[locale]/dashboard/config/sections";
import { Tile, type TileDef } from "@/app/[locale]/dashboard/config/shared-ui";
import { WHATSAPP_VOICE_AVAILABLE } from "@/lib/channels/contract";
import { PREVIEW_PLAN_LABEL, PREVIEW_RECEPTION_STATS, PREVIEW_VOICE, previewLang, previewNumber } from "@/lib/preview-samples";

import { LiveTestPreview } from "./LiveTestPreview";
import { PreviewFrame } from "./PreviewFrame";

const noop = () => {};

export function ReceptionPreview() {
  const t = useTranslations("DashboardConfig");
  const locale = useLocale();
  const lang = previewLang(locale);
  const langLabel = t(lang === "he" ? "langHe" : lang === "en" ? "langEn" : "langFr");
  const tiles: TileDef[] = [
    {
      id: "notifs",
      label: t("wowTileNotifs"),
      tagline: t("wowTagNotifs"),
      summary: t("wowNotifsSummaryActive"),
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      ),
    },
    {
      id: "channels",
      label: t("channelsTile"),
      tagline: WHATSAPP_VOICE_AVAILABLE ? t("channelsTileTagline") : t("channelsTileTaglinePhoneOnly"),
      summary: WHATSAPP_VOICE_AVAILABLE ? t("channelsTileSummary", { pstn: 1, wa: 0 }) : t("channelsTileSummaryPhoneOnly", { pstn: 1 }),
      accent: "from-[#25D366] to-[#128C7E]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
  ];

  return (
    <PreviewFrame>
      <style>{CONFIG_FORM_CSS}</style>
      {/* The same two-column layout as the owned page (config-form.tsx). */}
      <div className="relative xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        <HeroSection
          primaryPhone={previewNumber(lang)}
          stats={PREVIEW_RECEPTION_STATS}
          lastUpdatedLabel=""
          planLabel={PREVIEW_PLAN_LABEL[lang]}
          voice={PREVIEW_VOICE}
          currentLangLabel={langLabel}
          adminView
        />
        <aside className="mb-8 xl:col-start-2 xl:row-start-2 xl:mb-0">
          <LiveTestPreview />
        </aside>
        <fieldset disabled className="m-0 mb-6 min-w-0 border-0 p-0 xl:col-start-1 xl:row-start-2">
          <div className={GRID_TWO}>
            {tiles.map((tile, i) => (
              <Tile key={tile.id} tile={tile} active={false} onClick={noop} delay={300 + i * 60} sizeClass={TILE_ROW_SIZE_TWO} />
            ))}
          </div>
        </fieldset>
      </div>
    </PreviewFrame>
  );
}
