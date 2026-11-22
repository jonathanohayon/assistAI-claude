// The Ventes (sales) per-product trial cap, enforced in the campaign
// dispatcher (lib/campaigns/dispatch.ts). PURE (zero imports), table-tested
// in scripts/tests/sales-trial-cap.test.ts.
//
// An account whose sales entitlement comes ONLY from a sales trial row
// (account_product_trials) is refused a dial once now >= ends_at, or once
// its outbound seconds since started_at (campaign_calls.duration_seconds)
// reach minutes_included × 60. An account entitled to sales otherwise (paid
// record, grandfathered rule) or with no sales trial row is never refused
// here: the dispatcher behaves exactly as before for it.

/**
 * true ONLY because lib/campaigns/dispatch.ts calls the gate before every
 * dial (scripts/tests/sales-trial-cap.test.ts fails if that call is
 * removed). lib/product-trial-caps.ts reads it: a sales trial is startable
 * only while this cap is enforced.
 */
export const SALES_TRIAL_CAP_ENFORCED = true as const;

export type SalesTrialRefusal = "sales_trial_ended" | "sales_trial_minutes_used";

export type SalesTrialCapInput = {
  /** The account is entitled to the sales entry WITHOUT any trial (paid / grandfathered). */
  salesEntitledWithoutTrial: boolean;
  /** The account's sales trial row, or null. */
  trial: { startedAt: Date; endsAt: Date; minutesIncluded: number } | null;
  /** campaign_calls.duration_seconds summed since trial.startedAt. */
  usedSeconds: number;
  now: Date;
};

/** null = dial as before; otherwise the reason the dial is refused. */
export function salesTrialRefusal(input: SalesTrialCapInput): SalesTrialRefusal | null {
  if (input.salesEntitledWithoutTrial || input.trial === null) return null;
  if (input.now.getTime() >= input.trial.endsAt.getTime()) return "sales_trial_ended";
  const used = Number.isFinite(input.usedSeconds) && input.usedSeconds > 0 ? input.usedSeconds : 0;
  if (used >= Math.max(0, input.trial.minutesIncluded) * 60) return "sales_trial_minutes_used";
  return null;
}
