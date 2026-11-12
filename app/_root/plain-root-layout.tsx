import type { Metadata } from "next";

import { routing } from "@/i18n/routing";

import { RootHtml } from "./root-html";

// Fallback metadata for the routes outside [locale] (admin, legacy redirects).
export const metadata: Metadata = {
  title: "Tamara — Réceptionniste vocale IA",
  description:
    "Une secrétaire vocale qui prend les rendez-vous de votre salon en français, en hébreu et en anglais, 24/7.",
};

/**
 * Root layout of the non-localized segments. Each of them re-exports this file
 * as its own layout.tsx (see app/_root/root-html.tsx for why there is no
 * app/layout.tsx). Navigating between these and /[locale] routes is a full
 * page load, which is what Next.js does across root layouts.
 */
export default function PlainRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RootHtml locale={routing.defaultLocale}>{children}</RootHtml>;
}
