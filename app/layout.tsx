import type { Metadata } from "next";
import { Calistoga, Inter } from "next/font/google";
import { getLocale } from "next-intl/server";

import { isRTL, type Locale } from "@/i18n/routing";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const calistoga = Calistoga({
  variable: "--font-calistoga",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tamara — Réceptionniste vocale IA",
  description:
    "Une secrétaire vocale qui prend les rendez-vous de votre salon en français, en hébreu et en anglais, 24/7.",
};

// `getLocale()` here only seeds the initial-render <html> attributes for
// correct SSR (SEO, screen readers, no FOUC on Hebrew RTL). The root layout
// does NOT re-render between sibling locale routes during soft navigation,
// so NextIntlClientProvider lives in [locale]/layout.tsx where it can
// re-mount with fresh messages on /fr ↔ /en ↔ /he switches. The matching
// LocaleHtmlAttributes effect updates document.documentElement.lang/dir
// after client navigations to keep them in sync.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const dir = isRTL(locale) ? "rtl" : "ltr";
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${calistoga.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
