// Caps on the two public paths that send a verification email:
//   - POST /api/auth/resend-verification (email from the body, no session)
//   - the signup server action (each new address = a trial tenant + 1 email)
// Counts live in the shared DB limiter (lib/rate-limit-db.ts). Limiter keys
// are sha256 hex digests, so no address and no IP is stored in clear.

import { createHash } from "node:crypto";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Resend: 1 per 60 s per address (same as the DB cooldown in lib/verify-code.ts,
// but applied before the account lookup so the answer does not depend on
// whether the address exists), 5 per day per address, 200 per hour in total.
export const RESEND_COOLDOWN_BUCKET = "verif_resend_cooldown";
export const RESEND_COOLDOWN_MS = MINUTE_MS;
export const RESEND_ADDRESS_BUCKET = "verif_resend_address";
export const RESEND_PER_ADDRESS_PER_DAY = 5;
export const RESEND_GLOBAL_BUCKET = "verif_resend_global";
export const RESEND_GLOBAL_PER_HOUR = 200;
/** One shared key for the route-wide ceiling. */
export const GLOBAL_ACCOUNT_ID = "all";

// Signup: 5 per hour per client IP, 100 per hour in total.
export const SIGNUP_BUCKET = "signup";
export const SIGNUP_PER_IP_PER_HOUR = 5;
export const SIGNUP_GLOBAL_PER_HOUR = 100;

/** Neutral error codes these paths may return. No supplier, no env var, no raw error. */
export const VERIFICATION_ERRORS = ["invalid_email", "cooldown", "rate_limited"] as const;
export type VerificationError = (typeof VERIFICATION_ERRORS)[number];

/** Limiter key for an address or an IP: sha256 hex of the normalised value. */
export const limiterKey = (value: string): string =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export const normaliseEmail = (raw: unknown): string =>
  typeof raw === "string" ? raw.trim().toLowerCase() : "";

/** Same bar the signup form already used (an "@"), plus a sane length. */
export const isPlausibleEmail = (email: string): boolean =>
  email.length >= 3 && email.length <= 320 && email.includes("@") && !/\s/.test(email);
