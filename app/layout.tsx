import type { Metadata } from "next";
import { Calistoga, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale is resolved by next-intl from the URL segment for /[locale]/...
  // routes, or from the NEXT_LOCALE cookie / default for non-localized
  // routes (dashboard, login, etc.). RTL only applies to Hebrew.
  const locale = (await getLocale()) as Locale;
  const dir = isRTL(locale) ? "rtl" : "ltr";
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${calistoga.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
