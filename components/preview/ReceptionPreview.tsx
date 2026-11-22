"use client";

/**
 * Réception, not owned (F2): the REAL reception overview (the hero with its
 * number and figures) over sample data, beside a STATIC live test mock
 * (LiveTestPreview: never a session). No tile: the channels and
 * notifications tiles are on Mon agent, real for every account. Read-only:
 * nothing is fetched or saved. The account's own settings are not read:
 * everything shown is a sample.
 */

import { useLocale, useTranslations } from "next-intl";

import { CONFIG_FORM_CSS } from "@/app/[locale]/dashboard/config/config-form-css";
import { HeroSection } from "@/app/[locale]/dashboard/config/hero-section";
import { PREVIEW_PLAN_LABEL, PREVIEW_RECEPTION_STATS, PREVIEW_VOICE, previewLang, previewNumber } from "@/lib/preview-samples";

import { LiveTestPreview } from "./LiveTestPreview";
import { PreviewFrame } from "./PreviewFrame";

export function ReceptionPreview() {
  const t = useTranslations("DashboardConfig");
  const locale = useLocale();
  const lang = previewLang(locale);
  const langLabel = t(lang === "he" ? "langHe" : lang === "en" ? "langEn" : "langFr");

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
      </div>
    </PreviewFrame>
  );
}
