// Verified contacts, N2: the rules of the owner recap EMAIL confirmation
// (pure, no I/O). Endpoints: lib/recap-email-code/handler.ts.

import { contactState } from "@/lib/contact-confirmation";

export const RECAP_EMAIL_KIND = "owner_recap_email" as const;

/** Shared limiter buckets (lib/rate-limit-db.ts). */
export const RECAP_EMAIL_CODE_ACCOUNT_BUCKET = "recap_email_code_account";
export const RECAP_EMAIL_CODE_VALUE_BUCKET = "recap_email_code_value";

export interface RecapEmailCodeLimits {
  /** Codes per account per rolling hour (429 scope "account"). */
  perAccountHourly: number;
  /** Codes across ALL accounts per rolling hour (429 scope "global"). */
  globalHourly: number;
  /** Codes per address (sha256 of the normalised address) per rolling day (429 scope "value"). */
  perValueDaily: number;
  /** Ceiling of the per-address ledger per day (bounds its size; 429 scope "global"). */
  valueLedgerDaily: number;
}

export const RECAP_EMAIL_CODE_LIMITS: RecapEmailCodeLimits = {
  perAccountHourly: 5,
  globalHourly: 50,
  perValueDaily: 3,
  valueLedgerDaily: 500,
};

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

/** Every error code the two endpoints may return (the UI maps them to words). */
export const RECAP_EMAIL_CODE_ERRORS = [
  "unauthorized",
  "forbidden",
  "no_config",
  "no_saved_address",
  "already_confirmed",
  "rate_limited",
  "send_failed",
  "not_configured",
  "invalid_code",
  "code_expired",
  "too_many_attempts",
] as const;
export type RecapEmailCodeError = (typeof RECAP_EMAIL_CODE_ERRORS)[number];
export type RecapEmailCodeScope = "value" | "account" | "global";

export type RecapEmailConfirmationView = { state: "confirmed"; at?: string } | { state: "unconfirmed"; at?: string };

/**
 * The confirmation state of the SAVED recap address, for the dashboard
 * (never a code): null when no address is saved. A grandfathered address
 * (saved before N1, no record) reads confirmed, without a date.
 */
export function recapEmailConfirmationView(value: unknown, record: unknown): RecapEmailConfirmationView | null {
  const s = contactState(RECAP_EMAIL_KIND, value, record);
  if (s.state === "confirmed") return s.source === "record" ? { state: "confirmed", at: s.at } : { state: "confirmed" };
  if (s.reason === "no_value") return null;
  return s.at ? { state: "unconfirmed", at: s.at } : { state: "unconfirmed" };
}
