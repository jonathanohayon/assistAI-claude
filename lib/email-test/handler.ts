// POST /api/dashboard/notifications/email-test — the handler, with every I/O
// injected (route.ts wires the real ones; tests inject fakes, so no test ever
// sends an email).
//
// Responses (neutral codes only: no supplier name, no configuration name, no
// raw provider error — those go to the server log, without the address):
//   200 { ok: true, id }
//   400 { error: "invalid_email" }          missing / malformed address or body
//   401 { error: "unauthorized" }           no session
//   403 { error: "forbidden" }              ?asUserId by a non-admin
//   403 { error: "recipient_not_allowed" }  neither the login nor the saved recap address
//   429 { error: "rate_limited", scope: "account" | "global" } + Retry-After header
//   500 { error: "send_failed" } | { error: "not_configured" }

import { NextResponse, type NextRequest } from "next/server";

import type { LogEvent } from "@/lib/logger";
import {
  isWellFormedEmail,
  matchAllowedRecipient,
  sanitizeProviderError,
  type EmailTestError,
  type RateScope,
} from "@/lib/email-test/policy";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";

export interface EmailTestAccount {
  loginEmail: string;
  /** Saved owner recap address ("" when none); also an allowed recipient. */
  ownerRecapEmail: string;
  displayName: string | null;
}

export interface EmailTestSendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** Set when no sender is configured (nothing was delivered). */
  fallback?: string;
}

export interface EmailTestDeps {
  /** Session + admin scoping (resolveTargetUserId). */
  resolveTarget(req: NextRequest): Promise<{ userId: string } | { unauthorized: true } | { forbidden: true }>;
  loadAccount(userId: string): Promise<EmailTestAccount | null>;
  /** Counts the attempt for this account (consumeRateLimit, bucket "email_test"). */
  claim(userId: string): Promise<RateLimitResult>;
  send(to: string, opts: { recipientName?: string | null; locale?: string | null }): Promise<EmailTestSendResult>;
  log(ev: LogEvent): Promise<void>;
  /** Values to redact from logged provider errors. */
  secrets(): string[];
}

const fail = (error: EmailTestError, status: number, scope?: RateScope, retryAfterSec?: number) =>
  NextResponse.json(scope ? { error, scope } : { error }, {
    status,
    headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
  });

export async function handleEmailTest(req: NextRequest, deps: EmailTestDeps): Promise<NextResponse> {
  const target = await deps.resolveTarget(req);
  if ("unauthorized" in target) return fail("unauthorized", 401);
  if ("forbidden" in target) return fail("forbidden", 403);
  const userId = target.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_email", 400);
  }
  const to = body && typeof body === "object" && !Array.isArray(body) ? (body as { to?: unknown }).to : undefined;
  if (!isWellFormedEmail(to)) return fail("invalid_email", 400);

  const account = await deps.loadAccount(userId);
  const recipient = account ? matchAllowedRecipient(to, account) : null;
  if (!account || !recipient) return fail("recipient_not_allowed", 403);

  // Counted BEFORE sending, atomically (lib/rate-limit-db.ts).
  let verdict: RateLimitResult;
  try {
    verdict = await deps.claim(userId);
  } catch (e) {
    await deps.log({
      source: "web",
      level: "error",
      event: "email_test_rate_limit_failed",
      message: "Email test: rate limiter unavailable",
      userId,
      metadata: { error: sanitizeProviderError(e, deps.secrets()) },
    });
    return fail("send_failed", 500);
  }
  if (!verdict.ok) return fail("rate_limited", 429, verdict.scope, verdict.retryAfterSec);

  const localeParam = req.nextUrl.searchParams.get("locale");
  const acceptLang = req.headers.get("accept-language") ?? "";
  const locale = localeParam ?? acceptLang.split(",")[0]?.split("-")[0] ?? "fr";

  let result: EmailTestSendResult;
  try {
    result = await deps.send(recipient, {
      recipientName: account.displayName?.trim() || account.loginEmail.split("@")[0],
      locale,
    });
  } catch (e) {
    result = { ok: false, error: sanitizeProviderError(e, deps.secrets()) };
  }

  if (!result.ok) {
    await deps.log({
      source: "web",
      level: "error",
      event: "email_test_failed",
      message: "Email test: send failed",
      userId,
      // Raw provider error, server-side only, address and secrets redacted.
      metadata: { error: sanitizeProviderError(result.error ?? "unknown", deps.secrets()) },
    });
    return fail("send_failed", 500);
  }
  if (result.fallback) {
    await deps.log({
      source: "web",
      level: "warn",
      event: "email_test_not_configured",
      message: "Email test: no email sender configured",
      userId,
      metadata: {},
    });
    return fail("not_configured", 500);
  }
  await deps.log({
    source: "web",
    event: "email_test_sent",
    message: "Email test sent",
    userId,
    metadata: { id: result.id ?? null },
  });
  return NextResponse.json({ ok: true, id: result.id });
}
