// "Set up your agent" — pure helpers: whether the block starts open, and the
// next step shown on its collapsed row. Client-safe, no I/O.

import { withFirstStep } from "@/lib/doors-ui";

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

/**
 * The first step still to do, in the list's order (null when all are done).
 * A locked step (not in the plan: it shows the upsell) is never "next".
 */
export function nextStep<T extends { done: boolean; locked?: boolean }>(items: readonly T[]): T | null {
  return items.find((i) => !i.done && !i.locked) ?? null;
}

/**
 * The steps in the account's door order (its first step on top; every step
 * kept) and the progress. A locked step stays listed with its upsell but
 * does not count: the customer can't complete it on this plan.
 */
export function checklistSteps<T extends { id: string; done: boolean; locked?: boolean }>(
  items: readonly T[],
  door: unknown,
): { items: T[]; done: number; total: number } {
  const ordered = withFirstStep(items, door);
  const counted = ordered.filter((i) => !i.locked);
  return { items: ordered, done: counted.filter((i) => i.done).length, total: counted.length };
}
