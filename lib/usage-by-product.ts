// Per-product usage for one billing period (P2). PURE: no lib/db, no
// network (client-safe imports only), so it is table-tested
// (scripts/tests/usage-by-product.test.ts).
//
// Two shapes, decided by the account's entitlement source:
//   - "products" (a VALID users.products record): one row per ENTRY
//     (reception / sales / connect). Each entry has its own included minutes
//     (the sum of the catalogue minutes of the owned products mapping to it)
//     and its own overage rate, in the account's currency. NO shared pool.
//   - "grandfathered" (no record, or an invalid one): exactly today's single
//     pool (billing-stats `usage`): PLANS minutesIncluded and
//     OVERAGE_RATE_ILS_PER_MIN over inbound + outbound, as ONE "pool" row,
//     so today's numbers are unchanged.
//
// Where the seconds come from:
//   calls.product NULL or "reception" → reception; "connect" → connect;
//   "sales" → sales; every campaign_calls row → sales.
// A call is in the period when window.start <= createdAt <= window.end
// (the same bounds as billing-stats).

import type { CatalogueCurrency, ProductCatalogue } from "./product-catalogue";
import type { Entitlement } from "./product-entitlement";
import type { TrialUsage } from "./product-trials";
import { PRODUCT_ENTRIES, entryOf, type Product, type ProductEntry } from "./product-values";
import { TRIAL_MINUTES_INCLUDED } from "./trial";

export type UsageCall = { durationSeconds: number; product: string | null; createdAt: Date };
export type UsageCampaignCall = { durationSeconds: number; createdAt: Date };

export type EntryUsage = {
  entry: ProductEntry;
  /** false = usage on an entry the account does not own (0 minutes included). */
  owned: boolean;
  /** The owned products mapping to this entry (e.g. ["reception_multi"]). */
  products: Product[];
  usedSeconds: number;
  /** Rounded like billing-stats `usage.minutesUsed` (Math.round(seconds / 60)). */
  usedMinutes: number;
  includedMinutes: number;
  overageMinutes: number;
  /** Per minute, in `currency`. */
  overageRate: number;
  /** overageMinutes × overageRate, rounded to cents, in `currency`. */
  overageAmount: number;
  /**
   * Present only on the reception entry while the account is on its sign-up
   * trial (trialing / trial_paused, non-admin). The entry then carries the
   * trial cap instead of the catalogue: includedMinutes =
   * TRIAL_MINUTES_INCLUDED, usedSeconds / usedMinutes = what the trial gate
   * counts (all-time calls seconds, not the period), and no overage.
   */
  signupTrial?: SignupTrialCap;
};

export type SignupTrialCap = {
  /** users.trialEndsAt, ISO; null when unset. */
  endsAt: string | null;
  minutesIncluded: number;
  usedMinutes: number;
};

export type PoolUsage = {
  entry: "pool";
  usedSeconds: number;
  usedMinutes: number;
  includedMinutes: number;
  overageMinutes: number;
  overageRate: number;
  overageAmount: number;
};

export type UsageByProduct =
  | {
      kind: "products";
      currency: CatalogueCurrency;
      entries: EntryUsage[];
      /** P3, additive: present only when the account has per-product trial rows. */
      trials?: TrialUsage[];
    }
  | { kind: "pool"; currency: "ILS"; entries: [PoolUsage] };

export type UsageByProductInput = {
  calls: UsageCall[];
  campaignCalls: UsageCampaignCall[];
  window: { start: Date; end: Date };
  entitlement: Entitlement;
  catalogue: ProductCatalogue;
  /** The account's currency (billing-stats: currencyForLocale). */
  currency: CatalogueCurrency;
  /** Grandfathered pool: PLANS[plan].minutesIncluded. */
  planMinutes: number;
  /** Grandfathered pool: OVERAGE_RATE_ILS_PER_MIN. */
  planOverage: number;
  /**
   * The sign-up trial, when its gate applies (trialing / trial_paused,
   * non-admin): `secondsUsed` is the gate's own count
   * (signupTrialSecondsUsed). Absent = a paid account: catalogue minutes over
   * the period, exactly as before. Ignored for a grandfathered account.
   */
  signupTrial?: { endsAt: Date | null; secondsUsed: number };
};

const cents = (n: number) => Math.round(n * 100) / 100;

function inWindow(d: Date, w: { start: Date; end: Date }): boolean {
  const t = d.getTime();
  return t >= w.start.getTime() && t <= w.end.getTime();
}

/** The entry a calls row counts against (NULL = reception). */
export function entryOfCall(product: string | null): ProductEntry {
  return product === "sales" || product === "connect" ? product : "reception";
}

function seconds(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function usageByProduct(input: UsageByProductInput): UsageByProduct {
  const { window } = input;
  const used: Record<ProductEntry, number> = { reception: 0, sales: 0, connect: 0 };
  for (const c of input.calls) if (inWindow(c.createdAt, window)) used[entryOfCall(c.product)] += seconds(c.durationSeconds);
  for (const c of input.campaignCalls) if (inWindow(c.createdAt, window)) used.sales += seconds(c.durationSeconds);

  if (input.entitlement.source !== "products") {
    const usedSeconds = used.reception + used.sales + used.connect;
    const usedMinutes = Math.round(usedSeconds / 60);
    const overageMinutes = Math.max(0, usedMinutes - input.planMinutes);
    return {
      kind: "pool",
      currency: "ILS",
      entries: [
        {
          entry: "pool",
          usedSeconds,
          usedMinutes,
          includedMinutes: input.planMinutes,
          overageMinutes,
          overageRate: input.planOverage,
          overageAmount: cents(overageMinutes * input.planOverage),
        },
      ],
    };
  }

  const { base, addons } = input.entitlement;
  const owned: Product[] = [...(base ? [base] : []), ...addons];
  const entries: EntryUsage[] = [];
  for (const entry of PRODUCT_ENTRIES) {
    const products = owned.filter((p) => entryOf(p) === entry);
    const isOwned = products.length > 0;
    const trial = entry === "reception" ? input.signupTrial : undefined;
    if (trial) {
      // The sign-up trial cap: the gate refuses calls at the cap, so there
      // is no overage; the reception entry is always shown.
      const usedSeconds = seconds(trial.secondsUsed);
      const usedMinutes = Math.round(usedSeconds / 60);
      entries.push({
        entry,
        owned: isOwned,
        products,
        usedSeconds,
        usedMinutes,
        includedMinutes: TRIAL_MINUTES_INCLUDED,
        overageMinutes: 0,
        overageRate: input.catalogue[products[0] ?? entry][input.currency].overagePerMin,
        overageAmount: 0,
        signupTrial: { endsAt: trial.endsAt ? trial.endsAt.toISOString() : null, minutesIncluded: TRIAL_MINUTES_INCLUDED, usedMinutes },
      });
      continue;
    }
    if (!isOwned && used[entry] === 0) continue;
    const includedMinutes = products.reduce((s, p) => s + input.catalogue[p][input.currency].minutes, 0);
    // The rate: the base product's when it maps here, else the first owned
    // add-on's; an unowned entry uses its own product's catalogue rate.
    const rateProduct: Product = products[0] ?? entry;
    const overageRate = input.catalogue[rateProduct][input.currency].overagePerMin;
    const usedMinutes = Math.round(used[entry] / 60);
    // No overage during the sign-up trial, on any entry.
    const overageMinutes = input.signupTrial ? 0 : Math.max(0, usedMinutes - includedMinutes);
    entries.push({
      entry,
      owned: isOwned,
      products,
      usedSeconds: used[entry],
      usedMinutes,
      includedMinutes,
      overageMinutes,
      overageRate,
      overageAmount: cents(overageMinutes * overageRate),
    });
  }
  return { kind: "products", currency: input.currency, entries };
}
