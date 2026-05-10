import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "he", "en"],
  defaultLocale: "fr",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  fr: "Français",
  he: "עברית",
  en: "English",
};

export const LOCALE_FLAG: Record<Locale, string> = {
  fr: "🇫🇷",
  he: "🇮🇱",
  en: "🇺🇸",
};

export const isRTL = (locale: Locale): boolean => locale === "he";
