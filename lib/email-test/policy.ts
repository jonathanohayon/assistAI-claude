// Pure rules for POST /api/dashboard/notifications/email-test (no I/O, so
// scripts/tests/email-test-hardening.test.ts can probe every branch).
//
// The route used to send a branded email to ANY address in the body, with no
// limit: a spam relay for any signed-in account. Now:
//   - the only allowed recipients are the account's own addresses: its login
//     email and its saved owner recap address (agent_configs.owner_recap_email);
//   - every allowed attempt is counted (per account + global) BEFORE sending,
//     with the shared DB limiter (lib/rate-limit-db.ts, bucket EMAIL_TEST_BUCKET);
//   - responses carry neutral codes only (EMAIL_TEST_ERRORS).

/** Shared limiter bucket (lib/rate-limit-db.ts). */
export const EMAIL_TEST_BUCKET = "email_test";
/** Max allowed attempts per account in a rolling hour (the 6th gets 429 scope "account"). */
export const EMAIL_TEST_PER_ACCOUNT_LIMIT = 5;
/** Max allowed attempts across ALL accounts in a rolling hour (429 scope "global"). */
export const EMAIL_TEST_GLOBAL_LIMIT = 50;
/** Rolling window for both limits. */
export const EMAIL_TEST_WINDOW_MS = 60 * 60_000;

/** Every error code this route may return (the UI maps them to words). */
export const EMAIL_TEST_ERRORS = [
  "unauthorized",
  "forbidden",
  "invalid_email",
  "recipient_not_allowed",
  "rate_limited",
  "send_failed",
  "not_configured",
] as const;
export type EmailTestError = (typeof EMAIL_TEST_ERRORS)[number];
export type { RateLimitScope as RateScope } from "@/lib/rate-limit-db-core";

/** trim + lowercase: the comparison form of an address. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Basic shape check (the provider validates more strictly). */
export function isWellFormedEmail(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  return v.length > 0 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export interface TestRecipientAccount {
  /** users.email — the account's login address. */
  loginEmail: string;
  /**
   * agent_configs.owner_recap_email — the saved owner recap address ("" or
   * absent when none is saved, or when the account has no agent config).
   */
  ownerRecapEmail?: string | null;
}

/**
 * The addresses a test email may be sent to for this account, normalised:
 * the login email and the saved owner recap address. An empty saved address
 * adds nothing. The recap switch (owner_recap_email_enabled) deliberately does
 * NOT matter here: a saved address can be tested before it is switched on.
 */
export function allowedTestRecipients(account: TestRecipientAccount): string[] {
  const list = [account.loginEmail, account.ownerRecapEmail]
    .filter((e): e is string => typeof e === "string" && isWellFormedEmail(e))
    .map(normaliseEmail);
  return [...new Set(list)];
}

/** The allowed address `to` matches, or null. */
export function matchAllowedRecipient(to: string, account: TestRecipientAccount): string | null {
  const n = normaliseEmail(to);
  return allowedTestRecipients(account).find((a) => a === n) ?? null;
}

/**
 * A provider error made safe for the server log: no address, no secret,
 * bounded length. It is never put in a response.
 */
export function sanitizeProviderError(raw: unknown, secrets: readonly string[] = []): string {
  let s = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) s = s.split(secret).join("[secret]");
  }
  s = s.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[address]");
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}
