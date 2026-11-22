// Which first screen /[locale]/onboarding shows an account: ONE pure function
// of its door and of whether the door's product is usable today. Client-safe
// (pure value modules and types only; the tenant bundle check reads what a
// client component pulls in).
//
//   door        usable   screen
//   reception   (always) wizard    today's Réception wizard, unchanged
//   sales       no       welcome   "Bienvenue. {Produit} ouvre bientôt."
//   sales       yes      wizard    unchanged behaviour until that screen exists
//   connect     no       welcome
//   connect     yes      wizard    unchanged behaviour until that screen exists
//   null / junk  —       wizard    (an account with no door is a reception one)
//
// "usable" is lib/public-offer.ts publicOffer().available (the sign-up page's
// and the pricing cards' own rule); the page passes it in, this file never
// reads the deployment. The usable sales / connect onboarding is out of scope:
// it will be a new screen in SCREEN below, nothing else changes.
// scripts/tests/onboarding-route.test.ts pins the table.

import { entryHref } from "./dashboard-nav";
import { DOORS, type Door } from "./door-values";
import type { PublicAvailability } from "./public-plan-pricing";

export type OnboardingScreen = "wizard" | "welcome";

/** The door's screen while its product is usable / not usable. */
export const SCREEN: Readonly<Record<Door, { usable: OnboardingScreen; notUsable: OnboardingScreen }>> = {
  reception: { usable: "wizard", notUsable: "wizard" },
  sales: { usable: "wizard", notUsable: "welcome" },
  connect: { usable: "wizard", notUsable: "welcome" },
};

function asDoor(x: unknown): Door | null {
  return typeof x === "string" && (DOORS as readonly string[]).includes(x) ? (x as Door) : null;
}

/** Is the door's product usable today? Reception always is. */
export function doorUsable(door: Door, available: PublicAvailability): boolean {
  return door === "reception" ? true : available[door] === true;
}

/** The first onboarding screen of an account. Unknown / missing door = reception. */
export function onboardingScreen(door: unknown, available: PublicAvailability): OnboardingScreen {
  const d = asDoor(door) ?? "reception";
  return doorUsable(d, available) ? SCREEN[d].usable : SCREEN[d].notUsable;
}

/** The welcome screen's doors (the products that are not open yet). */
export type WelcomeDoor = Exclude<Door, "reception">;

/** "Voir l'aperçu": the product's page in the dashboard (its preview while not owned). */
export function previewHref(door: WelcomeDoor): string {
  return entryHref(door) as string;
}

export type WelcomeLanguage = "fr" | "he" | "en";

/** Both fields of the welcome form are required before either button. */
export function welcomeFormValid(companyName: string, language: string | null | undefined): boolean {
  return companyName.trim().length > 0 && (language === "fr" || language === "he" || language === "en");
}
