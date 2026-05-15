"use client";

import { useTranslations } from "next-intl";

import {
  CURRENCY_META,
  type Currency,
  useCurrency,
} from "./CurrencyContext";

export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  const t = useTranslations("CurrencySwitcher");

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        value={currency}
        onChange={(e) => setCurrency(e.target.value as Currency)}
        className="appearance-none rounded-full border border-[var(--color-border)] bg-white/80 py-1.5 ps-3 pe-7 text-xs font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur transition-colors hover:bg-white"
      >
        {(Object.keys(CURRENCY_META) as Currency[]).map((c) => (
          <option key={c} value={c}>
            {CURRENCY_META[c].symbol} {c}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className="pointer-events-none absolute end-2 h-3 w-3 text-[var(--color-muted-foreground)]"
      >
        <path
          d="m3 4.5 3 3 3-3"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </label>
  );
}
