// The landing's display currency per locale: the default of the home/landing
// Pricing section (components/marketing/Pricing.tsx, via components/plans/
// PlanCard.tsx) and the currency of the home demo's fictional prices
// (lib/demo-place.ts). Pure and client-safe, so a server module can import it
// (PlanCard.tsx is a client component).

export type Currency = "EUR" | "USD" | "ILS";

// Symbol + locale (for Intl.NumberFormat) per currency. The locale sets the
// symbol position (before/after) and the thousands separator.
export const CURRENCY_META: Record<Currency, { symbol: string; locale: string }> = {
  EUR: { symbol: "€", locale: "fr-FR" },
  USD: { symbol: "$", locale: "en-US" },
  ILS: { symbol: "₪", locale: "he-IL" },
};

/** Default currency by locale (FR→ILS, HE→ILS, EN→USD). */
export const LOCALE_TO_CURRENCY: Record<string, Currency> = {
  fr: "ILS",
  he: "ILS",
  en: "USD",
};

/** The landing's currency for a locale; EUR for a locale it does not know. */
export function landingCurrencyFor(locale: string): Currency {
  return LOCALE_TO_CURRENCY[locale] ?? "EUR";
}
