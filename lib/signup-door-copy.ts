// The sign-up page's title, subtitle and trial line per door: which Signup.*
// message keys to show. Pure and client-safe: it imports door values and a
// TYPE only, never the server-side offer (lib/public-offer.ts).
//
// "Usable" is NOT decided here. The sign-up page (a server component) reads
// it from publicOffer().available, the same function behind
// GET /api/public/plan-pricing's `available` (the pricing cards), and passes
// it in. There is no second rule.
//
//   reception (or no / unknown door): today's title, subtitle, trial line;
//   connect / sales: their own title, a subtitle for usable or "opens soon",
//     and the badge and trial line naming the Reception trial (a trial
//     grants reception only).
// scripts/tests/signup-per-door.test.ts pins all of it.

import type { Door } from "./door-values";
import type { PublicAvailability } from "./public-plan-pricing";

export type SignupTitleKey = "title" | "connectTitle" | "salesTitle";
export type SignupSubtitleKey =
  | "subtitle"
  | "connectSubtitleUsable"
  | "connectSubtitleSoon"
  | "salesSubtitleUsable"
  | "salesSubtitleSoon";

export interface SignupDoorCopy {
  title: SignupTitleKey;
  subtitle: SignupSubtitleKey;
  /** true: the badge and the trial line say it is the Reception trial
   *  (Signup.freeBadgeReception, Signup.freeTrialNoticeReceptionStart);
   *  false: today's badge and line. */
  receptionTrial: boolean;
}

export const RECEPTION_SIGNUP_COPY: SignupDoorCopy = { title: "title", subtitle: "subtitle", receptionTrial: false };

export function signupDoorCopy(door: Door, available: PublicAvailability): SignupDoorCopy {
  switch (door) {
    case "connect":
      return {
        title: "connectTitle",
        subtitle: available.connect ? "connectSubtitleUsable" : "connectSubtitleSoon",
        receptionTrial: true,
      };
    case "sales":
      return {
        title: "salesTitle",
        subtitle: available.sales ? "salesSubtitleUsable" : "salesSubtitleSoon",
        receptionTrial: true,
      };
    default:
      return RECEPTION_SIGNUP_COPY;
  }
}
