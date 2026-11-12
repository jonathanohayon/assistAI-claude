// POST /api/auth/resend-verification — the handler, with every I/O injected
// (deps.ts wires the real ones; tests inject a fake sender, so no test ever
// sends an email).
//
// Public route: the address comes from the body. The answer must not tell
// whether an account exists, so every limit runs BEFORE the account lookup and
// all post-lookup outcomes collapse into the same 200:
//   200 { ok: true }                                    accepted (sent, unknown address,
//                                                       already verified, send failure)
//   400 { ok: false, error: "invalid_email" }
//   429 { ok: false, error: "cooldown", cooldownSeconds } 1 per 60 s per address
//   429 { ok: false, error: "rate_limited" } + Retry-After  5/day/address or the hourly ceiling
// Failures are logged server-side only.

import type { LogEvent } from "@/lib/logger";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import {
  DAY_MS,
  GLOBAL_ACCOUNT_ID,
  HOUR_MS,
  isPlausibleEmail,
  limiterKey,
  normaliseEmail,
  RESEND_ADDRESS_BUCKET,
  RESEND_COOLDOWN_BUCKET,
  RESEND_COOLDOWN_MS,
  RESEND_GLOBAL_BUCKET,
  RESEND_GLOBAL_PER_HOUR,
  RESEND_PER_ADDRESS_PER_DAY,
  type VerificationError,
} from "@/lib/verification-limits/policy";

type ConsumeRateLimit = (opts: {
  bucket: string;
  accountId: string;
  windowMs: number;
  perAccount: number;
  global: number;
}) => Promise<RateLimitResult>;

export interface VerificationSendResult {
  ok: boolean;
  error?: string;
  fallback?: string;
}

export interface ResendDeps {
  consume: ConsumeRateLimit;
  findUser(email: string): Promise<{ id: string; emailVerified: boolean; locale: string | null } | null>;
  /** createEmailVerification (keeps its own 60 s DB cooldown). */
  createCode(userId: string): Promise<{ ok: boolean; code?: string; reason?: string; cooldownSeconds?: number }>;
  send(to: string, code: string, locale: string | null): Promise<VerificationSendResult>;
  log(ev: LogEvent): Promise<void>;
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown>;
  retryAfterSec?: number;
}

const fail = (error: VerificationError, status: number, extra: Record<string, unknown> = {}, retryAfterSec?: number): HandlerResponse => ({
  status,
  body: { ok: false, error, ...extra },
  retryAfterSec,
});
const ACCEPTED: HandlerResponse = { status: 200, body: { ok: true } };

export async function handleResendVerification(body: unknown, deps: ResendDeps): Promise<HandlerResponse> {
  const email = normaliseEmail(body && typeof body === "object" ? (body as { email?: unknown }).email : undefined);
  if (!isPlausibleEmail(email)) return fail("invalid_email", 400);
  const key = limiterKey(email);

  // Limits, in this order: a double tap does not burn a daily slot, and
  // requests refused for one address do not eat into the route-wide ceiling.
  try {
    const cd = await deps.consume({
      bucket: RESEND_COOLDOWN_BUCKET,
      accountId: key,
      windowMs: RESEND_COOLDOWN_MS,
      perAccount: 1,
      global: RESEND_GLOBAL_PER_HOUR,
    });
    if (!cd.ok) {
      return cd.scope === "account"
        ? fail("cooldown", 429, { cooldownSeconds: cd.retryAfterSec }, cd.retryAfterSec)
        : fail("rate_limited", 429, {}, cd.retryAfterSec);
    }
    const perAddress = await deps.consume({
      bucket: RESEND_ADDRESS_BUCKET,
      accountId: key,
      windowMs: DAY_MS,
      perAccount: RESEND_PER_ADDRESS_PER_DAY,
      // Only bounds the ledger size; the hourly bucket below is the real ceiling.
      global: RESEND_GLOBAL_PER_HOUR * 24,
    });
    if (!perAddress.ok) return fail("rate_limited", 429, {}, perAddress.retryAfterSec);
    const all = await deps.consume({
      bucket: RESEND_GLOBAL_BUCKET,
      accountId: GLOBAL_ACCOUNT_ID,
      windowMs: HOUR_MS,
      perAccount: RESEND_GLOBAL_PER_HOUR,
      global: RESEND_GLOBAL_PER_HOUR,
    });
    if (!all.ok) return fail("rate_limited", 429, {}, all.retryAfterSec);
  } catch {
    // Limiter unavailable: fail closed, same neutral answer.
    await deps.log({
      source: "auth",
      level: "error",
      event: "verification_resend_limiter_failed",
      message: "Verification resend: rate limiter unavailable",
    });
    return fail("rate_limited", 429);
  }

  const user = await deps.findUser(email);
  if (!user || user.emailVerified) return ACCEPTED;

  const verif = await deps.createCode(user.id);
  // DB cooldown (a code from < 60 s ago, e.g. the signup one): that code is
  // still valid, nothing is sent, and the answer stays the uniform 200.
  if (!verif.ok || !verif.code) {
    if (verif.reason !== "cooldown") {
      await deps.log({
        source: "auth",
        level: "error",
        event: "verification_resend_failed",
        message: "Verification resend: code creation failed",
        userId: user.id,
      });
    }
    return ACCEPTED;
  }

  let sent: VerificationSendResult;
  try {
    sent = await deps.send(email, verif.code, user.locale);
  } catch {
    sent = { ok: false, error: "exception" };
  }
  const isDevFallback = sent.fallback === "console_log";
  await deps.log({
    source: "auth",
    event: sent.ok ? "verification_resent" : "verification_resend_failed",
    message: sent.ok
      ? isDevFallback
        ? `[DEV] Code renvoyé à ${email} : ${verif.code} (no email sender configured)`
        : `Code renvoyé à ${email}`
      : `Renvoi du code à ${email} échoué`,
    level: sent.ok ? (isDevFallback ? "warn" : "info") : "error",
    userId: user.id,
    metadata: {
      fallback: sent.fallback,
      // Server-side log only; never in the response.
      error: sent.error,
      devCode: isDevFallback ? verif.code : undefined,
    },
  });
  return ACCEPTED;
}
