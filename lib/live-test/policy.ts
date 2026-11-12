// Pure rules for the dashboard live-test token (POST /api/live-test/token and
// its deprecated alias). No I/O.
//
// Each live test costs model minutes and its post-call recap feeds the owner's
// WhatsApp, so minting is rate-limited with the shared DB limiter
// (lib/rate-limit-db.ts, bucket LIVE_TEST_BUCKET), counted before the token is
// signed:
//   - per account = the tenant the token is FOR (the ?asUserId target when an
//     admin tests a tenant's agent). Admin mints count in that tenant's bucket
//     with the same limit: no admin branch, and even an admin session cannot
//     mint unbounded live tests.
//   - a global ceiling across all accounts.

/** Shared limiter bucket (lib/rate-limit-db.ts). */
export const LIVE_TEST_BUCKET = "live_test";
/** Max tokens per account in a rolling hour (the 21st gets 429 scope "account"). */
export const LIVE_TEST_PER_ACCOUNT_LIMIT = 20;
/** Max tokens across ALL accounts in a rolling hour (429 scope "global"). */
export const LIVE_TEST_GLOBAL_LIMIT = 200;
/** Rolling window for both limits. */
export const LIVE_TEST_WINDOW_MS = 60 * 60_000;

/**
 * Every error string this route may return. "Unauthorized" / "Forbidden" are
 * kept byte-for-byte from before the limit (the browser only shows the status).
 */
export const LIVE_TEST_ERRORS = ["Unauthorized", "Forbidden", "not_configured", "rate_limited", "unavailable"] as const;
export type LiveTestError = (typeof LIVE_TEST_ERRORS)[number];
