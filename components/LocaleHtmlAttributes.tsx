"use client";

import { useEffect } from "react";

import { isRTL, type Locale } from "@/i18n/routing";

// Keeps <html lang> and <html dir> in sync with the active locale during
// client-side soft navigations between /fr ↔ /en ↔ /he. The root layout
// can't re-render between sibling routes, so the <html> attributes set
// there get stale on locale switch — this effect bridges the gap.
export function LocaleHtmlAttributes({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr";
  }, [locale]);
  return null;
}
