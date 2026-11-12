import { Calistoga, Heebo, Inter } from "next/font/google";

import { isRTL, type Locale } from "@/i18n/routing";

import "../globals.css";

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

// Heebo: modern Hebrew sans-serif, same proportions as Inter.
// Used as the :lang(he) override, see globals.css.
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * The <html>/<body> shell shared by every root layout of the app.
 *
 * There is no app/layout.tsx on purpose: a single root layout cannot know the
 * locale without reading the request (getLocale() → headers()), which made
 * every page, the landing included, render dynamically. Instead each top-level
 * segment owns its root layout and passes the locale it knows statically:
 *  - app/[locale]/layout.tsx passes the `locale` route param, so /fr, /en and
 *    /he prerender with the right lang/dir. Soft navigation between locales
 *    re-renders that layout with the new param, which updates <html lang dir>.
 *  - the non-localized segments (admin, legacy redirects) pass the default
 *    locale, which is what getLocale() resolved to for them before.
 */
export function RootHtml({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <html
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
      className={`${inter.variable} ${calistoga.variable} ${heebo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
