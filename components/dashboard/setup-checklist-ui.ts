// "Set up your agent" — pure helpers: whether the block starts open, and the
// next step shown on its collapsed row. Client-safe, no I/O.

import { connectPageView, type ConnectPageInput } from "@/lib/connect-page-view";
import { withFirstStep } from "@/lib/doors-ui";
import type { ProductEntryState } from "@/lib/product-menu";
import { trialCta, type TrialCtaTrial } from "@/lib/trial-cta";

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

/**
 * What a PRODUCT step of the checklist shows ("import contacts" for Sales,
 * "paste your agent's address" for Connect). It is the MENU's decision
 * (lib/product-menu.ts, the one the sidebar uses), read through the header's
 * own rule (lib/trial-cta.ts trialCta), never a plan feature:
 *
 *   menu owned (or a running trial)  → "open":  the real product page, counted;
 *   preview "soon"                   → "soon":  "Bientôt", no link, not counted
 *                                                (the sidebar's own word; never
 *                                                an offer: nothing is on sale yet);
 *   preview "try", trial startable   → "try":   "Essayer gratuitement" → the
 *                                                product page (its header starts it);
 *   preview "try", otherwise         → "offer": "Voir l'offre" → the product page,
 *                                                as its header does (the account
 *                                                is NOT entitled to it: "try").
 *
 * No step ever names a plan ("Inclus dans le plan …"): the menu, not the
 * plan grid, says whether the account has the product.
 */
export type ProductStepView = "open" | "soon" | "try" | "offer";

export function productStepView(entry: ProductEntryState, trial: TrialCtaTrial): ProductStepView {
  if (entry.state === "owned") return "open";
  const kind = trialCta(entry, trial).kind;
  if (kind === "soon") return "soon";
  if (kind === "start") return "try";
  // An active trial makes the entry entitled (lib/products.ts), so a preview
  // with one running can't be seen; it would lead to the page, not an offer.
  if (kind === "active") return "open";
  return "offer";
}

/**
 * The Connect step: the Connect page's own decision (lib/connect-page-view.ts),
 * so the step and the page can't disagree (owned but the brick can't show →
 * the page says "soon", so does the step).
 */
export function connectStepView(input: ConnectPageInput & { trial: TrialCtaTrial }): ProductStepView {
  const view = connectPageView(input);
  return view.kind === "brick" ? "open" : productStepView({ state: "preview", cta: view.cta }, input.trial);
}
