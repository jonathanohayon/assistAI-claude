// Truth switches of the landing pages (/sales, /connect).
//
// A landing page says only what the product does TODAY. The richer lines of
// a promise the product does not keep yet live in the content objects behind
// one of these booleans, and stay hidden while it is false.
//
// THIS IS THE ONE PLACE THEY ARE SET. They flip to true only when the
// product does the thing on real calls, never to make a page read better.
// scripts/tests/landings-truth.test.ts renders every page with them off and
// fails on any booking / transfer / "within the minute" wording.

export type LandingSwitches = {
  /** Outbound calls book a meeting in the sales team's calendar. */
  outboundBookingEffective: boolean;
  /** Outbound calls transfer the person to a human. */
  outboundTransferEffective: boolean;
};

export const LANDING_SWITCHES: LandingSwitches = {
  outboundBookingEffective: false,
  outboundTransferEffective: false,
};

/** The locales a landing page is written in. */
export type LandingLocale = "fr" | "en" | "he";

/** One string in the three locales. */
export type Localized = Record<LandingLocale, string>;

export const LANDING_LOCALES: readonly LandingLocale[] = ["fr", "en", "he"];

export function asLandingLocale(locale: string): LandingLocale {
  return locale === "he" ? "he" : locale === "en" ? "en" : "fr";
}

/** Page metadata of a landing page (title + description, one locale). */
export type LandingMeta = { title: string; description: string };
