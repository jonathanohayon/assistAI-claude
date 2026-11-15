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
//
// Timing: the answer must not tell either, so the slow work for an existing
// unverified account (code generation + bcrypt hash + the email send) runs OFF
// the response path, through deps.defer (next/server after() in production).
// What stays on the path is the same for every address: the limits, then one
// indexed lookup. When defer cannot schedule (no request scope, e.g. a script),
// the work runs inline instead: correct, just not constant-time.

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
  /**
   * Runs `task` after the response is sent. Returns false when it could not be
   * scheduled (outside a request scope); the handler then runs it inline.
   * The task never throws.
   */
  defer(task: () => Promise<void>): boolean;
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

  const userId = user.id;
  const locale = user.locale;
  const task = () => deliverCode(email, userId, locale, deps);
  if (!deps.defer(task)) await task();
  return ACCEPTED;
}

/** Code + send + log for an existing unverified account. Never throws. */
async function deliverCode(email: string, userId: string, locale: string | null, deps: ResendDeps): Promise<void> {
  try {
    const verif = await deps.createCode(userId);
    // DB cooldown (a code from < 60 s ago, e.g. the signup one): that code is
    // still valid and nothing is sent.
    if (!verif.ok || !verif.code) {
      if (verif.reason !== "cooldown") {
        await deps.log({
          source: "auth",
          level: "error",
          event: "verification_resend_failed",
          message: "Verification resend: code creation failed",
          userId,
        });
      }
      return;
    }

    let sent: VerificationSendResult;
    try {
      sent = await deps.send(email, verif.code, locale);
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
        : "Verification resend: send failed",
      level: sent.ok ? (isDevFallback ? "warn" : "info") : "error",
      userId,
      metadata: {
        fallback: sent.fallback,
        // Server-side log only; never in the response.
        error: sent.error,
        devCode: isDevFallback ? verif.code : undefined,
      },
    });
  } catch {
    // Deferred: nobody awaits this, so nothing may escape. No address here.
    await deps
      .log({
        source: "auth",
        level: "error",
        event: "verification_resend_failed",
        message: "Verification resend: deferred delivery failed",
        userId,
      })
      .catch(() => {});
  }
}
