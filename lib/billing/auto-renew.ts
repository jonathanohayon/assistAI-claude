// Whether an account's subscription renews by itself at paidUntil.
//
// Today the answer is always NO. Nothing ever charges a saved card: the hourly
// cron (app/api/cron/billing/route.ts, Phase 2) expires every active account
// whose paidUntil has passed, and the token-renewal branch is only a comment
// there ("Phase D ajoutera ici la branche 'auto-renew via token'…").
//
// So neither HYP_TOKENS_ENABLED, nor the account's autoRenew flag, nor a stored
// hypToken can make this true: showing "renews automatically" would promise a
// charge that never happens. When the Phase D renewal job ships, flip
// PHASE_D_RENEWAL_JOB here (scripts/tests/renews-automatically.test.ts will
// fail until you do both together).
//
// Pure and cheap on purpose: no env read, no DB, no server-only import, so a
// server page can call it and hand the boolean to a client component.

/** Flip to true only when cron/billing actually charges the saved HYP token (Phase D). */
export const PHASE_D_RENEWAL_JOB = false;

export type AutoRenewAccount = {
  subscriptionStatus?: string | null;
  autoRenew?: boolean | null;
  hypToken?: string | null;
};

export function renewsAutomatically(account: AutoRenewAccount | null | undefined): boolean {
  if (!PHASE_D_RENEWAL_JOB) return false;
  if (!account) return false;
  return account.subscriptionStatus === "active" && account.autoRenew === true && !!account.hypToken;
}
