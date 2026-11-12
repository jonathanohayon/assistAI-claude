import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { RootHtml } from "../_root/root-html";
import { PUBLIC_NAMESPACES, pickNamespaces } from "@/i18n/public-namespaces";
import { routing, type Locale } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Per-locale <title>/description. The French metadata in
// app/_root/plain-root-layout.tsx only covers the routes outside [locale].
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

// This is a ROOT layout (there is no app/layout.tsx): it renders <html> with
// the lang/dir of the `locale` param, so /fr, /en and /he prerender statically
// (generateStaticParams + setRequestLocale, no request data read). On a soft
// navigation /fr → /he the param changes, this layout re-renders and React
// updates <html lang dir> and the provider's messages together.
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
    <RootHtml locale={typedLocale}>
      <NextIntlClientProvider locale={typedLocale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootHtml>
  );
}
