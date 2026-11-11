// "Set up your agent" — pure helpers: whether the block starts open, and the
// next step shown on its collapsed row. Client-safe, no I/O.

/** The customer's last open/closed choice, remembered in this browser ("1" / "0"). */
export const SETUP_OPEN_KEY = "tamara.setupChecklistOpen";

/** Nothing done yet → open (the steps ARE the dashboard); otherwise collapsed. */
export const defaultOpen = (done: number): boolean => done === 0;

/** The remembered choice wins; anything else → the default. */
export function resolveOpen(stored: string | null, done: number): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return defaultOpen(done);
}

/** The first step still to do, in the list's order (null when all are done). */
export function nextStep<T extends { done: boolean }>(items: readonly T[]): T | null {
  return items.find((i) => !i.done) ?? null;
}
