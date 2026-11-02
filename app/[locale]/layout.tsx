import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { LocaleHtmlAttributes } from "@/components/LocaleHtmlAttributes";
import { PUBLIC_NAMESPACES, pickNamespaces } from "@/i18n/public-namespaces";
import { routing, type Locale } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Per-locale <title>/description. The root layout's static metadata is French
// and only remains as a fallback for routes outside [locale].
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("title"), description: t("description") };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);
  // Public namespaces only (~23 KB instead of ~84 KB in every page's HTML);
  // the dashboard re-provides the full set. The provider must stay here, not
  // in the root layout, or the language switcher freezes on soft navigation.
  const messages = pickNamespaces(await getMessages(), PUBLIC_NAMESPACES);
  return (
    <NextIntlClientProvider locale={typedLocale} messages={messages}>
      <LocaleHtmlAttributes locale={typedLocale} />
      {children}
    </NextIntlClientProvider>
  );
}
