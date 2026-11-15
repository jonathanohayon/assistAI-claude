// Colour state of the public nav, kept pure so a test can pin it.

export type NavToneState = {
  /** The page has scrolled past the top (the nav's own scroll state). */
  scrolled: boolean;
  /** The hero under the nav is light (a landing door such as /connect). */
  overLight: boolean;
  /** The mobile drawer is open. */
  open: boolean;
};

/** The nav shows its white bar: once scrolled, from the top over a light
 *  hero, or while the mobile drawer is open. */
export function navBarIsWhite({ scrolled, overLight, open }: NavToneState): boolean {
  return scrolled || overLight || open;
}

/** "brand" = the purple wordmark; "onDark" = white, for a dark hero
 *  (the home's video, the /sales command centre) under a transparent nav. */
export type WordmarkTone = "brand" | "onDark";

/** The wordmark is white over a dark hero and purple on the white bar. */
export function wordmarkTone(state: NavToneState): WordmarkTone {
  return navBarIsWhite(state) ? "brand" : "onDark";
}
