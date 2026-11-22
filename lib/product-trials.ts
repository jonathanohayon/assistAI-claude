// Per-product trials (P3), PURE (imports only zero-import modules), so it is
// table-tested (scripts/tests/product-trials.test.ts).
//
// A per-product trial = 7 days + 30 minutes, no card, ONCE per account ×
// product (the unique (user_id, product) of account_product_trials). It is
// separate from the account-wide sign-up trial (lib/trial.ts, 14 days /
// 100 min, users.subscription_status "trialing"), which is unchanged.
//
// Startable = the product's feature flag is on AND its trial cap is
// enforced (lib/product-trial-caps.ts). Today only sales (Centre d'appels) has an
// enforced cap (the campaign dispatcher); Réception and Votre agent need the
// cap at call answering, which is held, so they are never startable.

import { dispatchMode } from "./campaigns/dispatch-mode";
import { PRODUCTS, PRODUCT_ENTRIES, entryOf, type Product, type ProductEntry } from "./product-values";
import { clientAgentMode } from "./tools/client-agent-switch";

export const PRODUCT_TRIAL_DAYS = 7;
export const PRODUCT_TRIAL_MINUTES = 30;

/** Whether each product's per-product trial cap is enforced somewhere. */
export type TrialCaps = Record<Product, boolean>;

type Env = Record<string, string | undefined>;

export function isProduct(x: unknown): x is Product {
  return typeof x === "string" && (PRODUCTS as readonly string[]).includes(x);
}

/** The product's site feature flag (no flag = on). */
export function productFlagOn(product: Product, env: Env): boolean {
  switch (product) {
    case "sales":
      // Campaigns dial nothing unless CAMPAIGN_DISPATCH is "on".
      return dispatchMode(env) === "on";
    case "connect":
      // Ask-your-agent: "all" only ("admin" is not a public launch).
      return clientAgentMode(env) === "all";
    default:
      return true;
  }
}

/** A per-product trial may be started: the flag is on AND the cap is enforced. */
export function productTrialStartable(product: Product, env: Env, caps: TrialCaps): boolean {
  return productFlagOn(product, env) && caps[product] === true;
}

/**
 * The per-product trial a NEW account starts from its sign-up door, or null.
 * reception (or no door) → none; sales / connect → that product, only when
 * productTrialStartable says so (else it stays "available" for later).
 */
export function signupDoorTrial(door: string | null, env: Env, caps: TrialCaps): Product | null {
  if (door !== "sales" && door !== "connect") return null;
  return productTrialStartable(door, env, caps) ? door : null;
}

/** The new trial's bounds from `now`. */
export function productTrialWindow(now: Date): { startedAt: Date; endsAt: Date; minutesIncluded: number } {
  return {
    startedAt: now,
    endsAt: new Date(now.getTime() + PRODUCT_TRIAL_DAYS * 24 * 3600_000),
    minutesIncluded: PRODUCT_TRIAL_MINUTES,
  };
}

export type ProductTrialRow = { product: string; startedAt: Date; endsAt: Date; minutesIncluded: number };

export type TrialState = { state: "available" | "used" | "active"; endsAt?: string };
export type TrialStates = Record<ProductEntry, TrialState>;

function isActive(r: ProductTrialRow, now: Date): boolean {
  return r.startedAt.getTime() <= now.getTime() && now.getTime() < r.endsAt.getTime();
}

/** The products whose trial is active now (unknown products ignored). */
export function activeTrialProducts(rows: ProductTrialRow[], now: Date): Product[] {
  const out: Product[] = [];
  for (const r of rows) if (isProduct(r.product) && isActive(r, now) && !out.includes(r.product)) out.push(r.product);
  return out;
}

/**
 * Per dashboard entry: "active" (a row started and now < ends_at), "used"
 * (a row exists and it ended), "available" (no row). Two rows on one entry
 * (reception + reception_multi): active wins, then the latest end.
 */
export function trialStates(rows: ProductTrialRow[], now: Date): TrialStates {
  const out = {} as TrialStates;
  for (const e of PRODUCT_ENTRIES) out[e] = { state: "available" };
  for (const r of rows) {
    if (!isProduct(r.product)) continue;
    const e = entryOf(r.product);
    const cur = out[e];
    const next: TrialState = { state: isActive(r, now) ? "active" : "used", endsAt: r.endsAt.toISOString() };
    if (cur.state === "available") out[e] = next;
    else if (cur.state === "used" && (next.state === "active" || (cur.endsAt ?? "") < (next.endsAt ?? ""))) out[e] = next;
    else if (cur.state === "active" && next.state === "active" && (cur.endsAt ?? "") < (next.endsAt ?? "")) out[e] = next;
  }
  return out;
}

export type TrialUsage = {
  product: Product;
  entry: ProductEntry;
  state: "active" | "used";
  startedAt: string;
  endsAt: string;
  minutesIncluded: number;
  usedSeconds: number;
  /** Rounded like usageByProduct (Math.round(seconds / 60)). */
  usedMinutes: number;
};

/**
 * Minutes used per trial row: the seconds on the trial's entry with
 * startedAt <= createdAt < endsAt. Calls: product NULL / "reception" →
 * reception, "sales" → sales, "connect" → connect; every campaign_calls row
 * → sales (the same mapping as lib/usage-by-product.ts).
 */
export function trialUsage(
  rows: ProductTrialRow[],
  calls: Array<{ durationSeconds: number; product: string | null; createdAt: Date }>,
  campaignCalls: Array<{ durationSeconds: number; createdAt: Date }>,
  now: Date,
): TrialUsage[] {
  const sec = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const entryOfCall = (p: string | null): ProductEntry => (p === "sales" || p === "connect" ? p : "reception");
  const out: TrialUsage[] = [];
  for (const r of rows) {
    if (!isProduct(r.product)) continue;
    const entry = entryOf(r.product);
    const inside = (d: Date) => d.getTime() >= r.startedAt.getTime() && d.getTime() < r.endsAt.getTime();
    let usedSeconds = 0;
    for (const c of calls) if (entryOfCall(c.product) === entry && inside(c.createdAt)) usedSeconds += sec(c.durationSeconds);
    if (entry === "sales") for (const c of campaignCalls) if (inside(c.createdAt)) usedSeconds += sec(c.durationSeconds);
    out.push({
      product: r.product,
      entry,
      state: isActive(r, now) ? "active" : "used",
      startedAt: r.startedAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      minutesIncluded: r.minutesIncluded,
      usedSeconds,
      usedMinutes: Math.round(usedSeconds / 60),
    });
  }
  return out;
}
