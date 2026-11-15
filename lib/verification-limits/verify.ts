// POST /api/auth/verify-email — the handler, with every I/O injected
// (deps.ts wires the real ones; tests inject fakes).
//
// Public route: the address and the code come from the body. The answer must
// not tell whether an account exists or whether it is already verified, so
// every limit runs BEFORE the account lookup and every outcome that would
// reveal account state collapses into one answer:
//   200 { ok: true }                                  correct code (first verification,
//                                                     or the latest code of an already
//                                                     verified account, within its TTL)
//   400 { ok: false, error: "invalid_code" }          unknown address, wrong code, no
//                                                     active code, expired code, tries
//                                                     exhausted, malformed code
//   400 { ok: false, error: "invalid_request" }       no plausible address in the body
//   429 { ok: false, error: "rate_limited" } + Retry-After
//                                                     10/h per client IP, 10/h per
//                                                     address, the hourly ceiling
//
// Already verified + correct code → the success answer. Only someone holding
// the code (so with access to the mailbox) can get it, and they already know
// the account exists; anyone else gets invalid_code, as for an unknown address.
//
// Timing: every path past the limits runs exactly one bcrypt compare at the
// code-hash cost (a dummy one when there is nothing real to compare), so the
// answer time does not tell an unknown address from an existing one.
// Logs carry a user id at most, never the address.

import type { LogEvent } from "@/lib/logger";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import { clientIp } from "@/lib/rate-limit";
import {
  GLOBAL_ACCOUNT_ID,
  HOUR_MS,
  isPlausibleEmail,
  limiterKey,
  normaliseEmail,
  VERIFY_ADDRESS_BUCKET,
  VERIFY_GLOBAL_BUCKET,
  VERIFY_GLOBAL_PER_HOUR,
  VERIFY_IP_BUCKET,
  VERIFY_PER_ADDRESS_PER_HOUR,
  VERIFY_PER_IP_PER_HOUR,
  type VerificationError,
} from "@/lib/verification-limits/policy";
import type { HandlerResponse } from "@/lib/verification-limits/resend";
import type { VerifyResult } from "@/lib/verify-code";

type ConsumeRateLimit = (opts: {
  bucket: string;
  accountId: string;
  windowMs: number;
  perAccount: number;
  global: number;
}) => Promise<RateLimitResult>;

export interface VerifyDeps {
  consume: ConsumeRateLimit;
  findUser(email: string): Promise<{ id: string; emailVerified: boolean } | null>;
  /** verifyEmailCode: one bcrypt compare on every outcome. */
  verifyCode(userId: string, code: string): Promise<VerifyResult>;
  /** matchesLatestCode, for an already verified account: one bcrypt compare. */
  matchesLatestCode(userId: string, code: string): Promise<boolean>;
  /** burnCodeCompare: one bcrypt compare that never matches (unknown address). */
  burnCompare(code: string): Promise<void>;
  log(ev: LogEvent): Promise<void>;
}

const fail = (error: VerificationError, status: number, retryAfterSec?: number): HandlerResponse => ({
  status,
  body: { ok: false, error },
  retryAfterSec,
});
const VERIFIED: HandlerResponse = { status: 200, body: { ok: true } };
const INVALID = (): HandlerResponse => fail("invalid_code", 400);

const CODE_FORMAT = /^\d{4}$/;

export async function handleVerifyEmail(
  input: { body: unknown; headers: Headers },
  deps: VerifyDeps,
): Promise<HandlerResponse> {
  const b = input.body && typeof input.body === "object" ? (input.body as { email?: unknown; code?: unknown }) : {};
  const email = normaliseEmail(b.email);
  const code = typeof b.code === "string" ? b.code.trim() : "";
  if (!isPlausibleEmail(email)) return fail("invalid_request", 400);

  // Limits, in this order: per client IP, per address, route-wide. All run
  // before the account lookup, so a refusal looks the same for any address.
  try {
    for (const rule of [
      { bucket: VERIFY_IP_BUCKET, accountId: limiterKey(clientIp(input.headers)), perAccount: VERIFY_PER_IP_PER_HOUR },
      { bucket: VERIFY_ADDRESS_BUCKET, accountId: limiterKey(email), perAccount: VERIFY_PER_ADDRESS_PER_HOUR },
      { bucket: VERIFY_GLOBAL_BUCKET, accountId: GLOBAL_ACCOUNT_ID, perAccount: VERIFY_GLOBAL_PER_HOUR },
    ]) {
      const r = await deps.consume({ ...rule, windowMs: HOUR_MS, global: VERIFY_GLOBAL_PER_HOUR });
      if (!r.ok) return fail("rate_limited", 429, r.retryAfterSec);
    }
  } catch {
    // Limiter unavailable: fail closed, same neutral answer.
    await deps.log({
      source: "auth",
      level: "error",
      event: "verify_limiter_failed",
      message: "Email verification: rate limiter unavailable",
    });
    return fail("rate_limited", 429, 60);
  }

  // A malformed code can never match; still pay the compare so it is not a
  // faster path than a wrong code.
  if (!CODE_FORMAT.test(code)) {
    await deps.burnCompare(code);
    return INVALID();
  }

  const user = await deps.findUser(email);
  if (!user) {
    await deps.burnCompare(code);
    return INVALID();
  }
  if (user.emailVerified) {
    return (await deps.matchesLatestCode(user.id, code)) ? VERIFIED : INVALID();
  }

  const result = await deps.verifyCode(user.id, code);
  if (!result.ok) {
    await deps.log({
      source: "auth",
      event: "verify_failed",
      message: `Email verification failed: ${result.reason}`,
      level: "warn",
      userId: user.id,
      metadata: { reason: result.reason, attemptsLeft: result.attemptsLeft },
    });
    return INVALID();
  }
  await deps.log({
    source: "auth",
    event: "verify_success",
    message: "Email verified",
    userId: user.id,
  });
  return VERIFIED;
}
