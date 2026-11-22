// The FR/HE/EN title of a product, from the EXISTING messages (no new
// wording): the two reception products use their plan names (Plans.global /
// Plans.premium: "Réceptionniste", "Clinique / Multi-sites"), sales and
// connect the dashboard menu titles (DashboardNav.sales / .connect).
// Reads messages/<locale>.json directly (no next-intl request scope), like
// lib/plan-i18n.ts, so emails and the HYP Info can use it.

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import he from "@/messages/he.json";

import { getLocalizedPlan } from "./plan-i18n";
import type { Product, ProductEntry } from "./product-values";

const NAV = { fr: fr.DashboardNav, he: he.DashboardNav, en: en.DashboardNav } as const;

const loc = (l: string | null | undefined): "fr" | "he" | "en" => (l === "he" || l === "en" ? l : "fr");

export function productTitle(locale: string | null | undefined, product: Product): string {
  switch (product) {
    case "reception":
      return getLocalizedPlan(loc(locale), "global").name;
    case "reception_multi":
      return getLocalizedPlan(loc(locale), "premium").name;
    case "sales":
      return NAV[loc(locale)].sales;
    case "connect":
      return NAV[loc(locale)].connect;
  }
}

/** The title of a dashboard entry (an overage line names its entry). */
export function entryTitle(locale: string | null | undefined, entry: ProductEntry): string {
  return entry === "reception" ? NAV[loc(locale)].reception : NAV[loc(locale)][entry];
}
