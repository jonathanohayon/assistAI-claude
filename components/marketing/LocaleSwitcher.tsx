"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { LOCALE_FLAG, LOCALE_LABEL, type Locale, routing } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const onChange = (next: string) => {
    startTransition(() => {
      router.replace(pathname, { locale: next as Locale });
    });
  };

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        value={locale}
        onChange={(e) => onChange(e.target.value)}
        disabled={isPending}
        className="appearance-none rounded-full border border-[var(--color-border)] bg-white/80 py-1.5 ps-3 pe-7 text-xs font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur transition-colors hover:bg-white disabled:opacity-50"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_FLAG[l]} {LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className="pointer-events-none absolute end-2 h-3 w-3 text-[var(--color-muted-foreground)]"
      >
        <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
