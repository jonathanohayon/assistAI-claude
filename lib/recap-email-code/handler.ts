// Verified contacts, N2: confirm the owner recap EMAIL address with a 6-digit
// code. The two handlers, every I/O injected (deps.ts wires the real ones;
// tests inject fakes or replace only the session and the sender, so no test
// ever sends an email).
//
// POST /api/dashboard/notifications/email/code[?asUserId=<uuid>]   (no body read)
//   Sends a code to the account's SAVED recap address, never to an address
//   from the request. Limits, counted before sending: per account / hour,
//   global / hour, per address / day.
//   200 { ok: true, expiresInSec }
//   401 unauthorized · 403 forbidden (asUserId by a non-admin)
//   404 { error: "no_config" }            no agent config
//   409 { error: "no_saved_address" }     no recap address saved
//   409 { error: "already_confirmed" }    the saved address is confirmed already
//   429 { error: "rate_limited", scope: "value" | "account" | "global" } + Retry-After
//   503 { error: "not_configured" }       no email sender (nothing sent, nothing counted)
//   500 { error: "send_failed" }
//
// POST /api/dashboard/notifications/email/confirm[?asUserId=<uuid>]  body { code }
//   200 { ok: true, recapEmailConfirmation: { state: "confirmed", at } }
//   400 { error: "invalid_code" }         wrong, malformed, no live code, or the address changed
//   400 { error: "code_expired" }         older than 10 minutes (ask for a new one)
//   400 { error: "too_many_attempts" }    5 wrong tries: the code is dead (ask for a new one)
//   401 · 403 · 404 no_config · 409 no_saved_address
//
// Neutral codes only: no supplier name, no configuration name, no provider
// error (server log only, address and secrets redacted). The code is never
// logged and never in a response; events carry the kind only.

import { NextResponse, type NextRequest } from "next/server";

import { contactState, type ContactKind } from "@/lib/contact-confirmation";
import { CODE_TTL_MS, parseCodeInput, valueKey } from "@/lib/contact-code";
import type { ConfirmCodeResult, ContactForCode } from "@/lib/contact-code-store";
import { sanitizeProviderError } from "@/lib/email-test/policy";
import type { LogEvent } from "@/lib/logger";
import {
  RECAP_EMAIL_KIND,
  type RecapEmailCodeError,
  type RecapEmailCodeScope,
} from "@/lib/recap-email-code/policy";

export type CodeClaim = { ok: true } | { ok: false; scope: RecapEmailCodeScope; retryAfterSec: number };

export interface CodeSendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** Set when no sender is configured (nothing was delivered). */
  fallback?: string;
}

export interface RecapEmailCodeDeps {
  /** Session + admin scoping (resolveTargetUserId). */
  resolveTarget(req: NextRequest): Promise<{ userId: string } | { unauthorized: true } | { forbidden: true }>;
  /** A sender is configured (lib/email-sender.ts). false → 503, never the default sender. */
  senderConfigured(): boolean;
  loadContact(userId: string, kind: ContactKind): Promise<ContactForCode | null>;
  /** Counts the send (account + global, then the address), BEFORE sending. */
  claim(userId: string, valueKey: string): Promise<CodeClaim>;
  generateCode(): string;
  generateSalt(): string;
  issue(input: { userId: string; kind: ContactKind; value: string; code: string; salt: string }): Promise<void>;
  drop(userId: string, kind: ContactKind, salt: string): Promise<void>;
  send(to: string, opts: { code: string; locale?: string | null }): Promise<CodeSendResult>;
  confirm(userId: string, kind: ContactKind, code: string): Promise<ConfirmCodeResult>;
  log(ev: LogEvent): Promise<void>;
  /** Values to redact from logged provider errors. */
  secrets(): string[];
}

const fail = (error: RecapEmailCodeError, status: number, scope?: RecapEmailCodeScope, retryAfterSec?: number) =>
  NextResponse.json(scope ? { error, scope } : { error }, {
    status,
    headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
  });

type Target = { userId: string } | { response: NextResponse };
async function target(req: NextRequest, deps: RecapEmailCodeDeps): Promise<Target> {
  const t = await deps.resolveTarget(req);
  if ("unauthorized" in t) return { response: fail("unauthorized", 401) };
  if ("forbidden" in t) return { response: fail("forbidden", 403) };
  return { userId: t.userId };
}

export async function handleSendRecapEmailCode(req: NextRequest, deps: RecapEmailCodeDeps): Promise<NextResponse> {
  const t = await target(req, deps);
  if ("response" in t) return t.response;
  const userId = t.userId;
  // Checked before anything is counted: the attempt costs no quota.
  if (!deps.senderConfigured()) return fail("not_configured", 503);

  const contact = await deps.loadContact(userId, RECAP_EMAIL_KIND);
  if (!contact) return fail("no_config", 404);
  if (contact.value === "") return fail("no_saved_address", 409);
  const state = contactState(RECAP_EMAIL_KIND, contact.value, contact.record);
  // A grandfathered address (no record) may still be confirmed (N5 grace).
  if (state.state === "confirmed" && state.source === "record") return fail("already_confirmed", 409);

  let verdict: CodeClaim;
  try {
    verdict = await deps.claim(userId, valueKey(RECAP_EMAIL_KIND, contact.value));
  } catch (e) {
    await deps.log({
      source: "web",
      level: "error",
      event: "recap_email_code_rate_limit_failed",
      message: "Recap email code: rate limiter unavailable",
      userId,
      metadata: { kind: RECAP_EMAIL_KIND, error: sanitizeProviderError(e, deps.secrets()) },
    });
    return fail("send_failed", 500);
  }
  if (!verdict.ok) return fail("rate_limited", 429, verdict.scope, verdict.retryAfterSec);

  const code = deps.generateCode();
  const salt = deps.generateSalt();
  // Stored (hashed) before sending: the code in the email is always the live one.
  await deps.issue({ userId, kind: RECAP_EMAIL_KIND, value: contact.value, code, salt });

  let result: CodeSendResult;
  try {
    result = await deps.send(contact.value, { code, locale: contact.locale });
  } catch (e) {
    result = { ok: false, error: sanitizeProviderError(e, deps.secrets()) };
  }
  if (!result.ok || result.fallback) {
    // Nothing delivered: this code must not stay live.
    await deps.drop(userId, RECAP_EMAIL_KIND, salt);
    await deps.log({
      source: "web",
      level: result.ok ? "warn" : "error",
      event: result.ok ? "recap_email_code_not_configured" : "recap_email_code_send_failed",
      message: result.ok ? "Recap email code: no email sender configured" : "Recap email code: send failed",
      userId,
      // Provider error, server-side only, address and secrets redacted. Never the code.
      metadata: result.ok
        ? { kind: RECAP_EMAIL_KIND }
        : { kind: RECAP_EMAIL_KIND, error: sanitizeProviderError(result.error ?? "unknown", [...deps.secrets(), code]) },
    });
    return result.ok ? fail("not_configured", 503) : fail("send_failed", 500);
  }
  await deps.log({
    source: "web",
    event: "recap_email_code_sent",
    message: "Recap email confirmation code sent",
    userId,
    metadata: { kind: RECAP_EMAIL_KIND, id: result.id ?? null },
  });
  return NextResponse.json({ ok: true, expiresInSec: CODE_TTL_MS / 1000 });
}

export async function handleConfirmRecapEmailCode(req: NextRequest, deps: RecapEmailCodeDeps): Promise<NextResponse> {
  const t = await target(req, deps);
  if ("response" in t) return t.response;
  const userId = t.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined;
  const code = parseCodeInput(raw);
  // A malformed code counts no try: it cannot be the code.
  if (!code) return fail("invalid_code", 400);

  const result = await deps.confirm(userId, RECAP_EMAIL_KIND, code);
  if (!result.ok) {
    if (result.error === "no_config") return fail("no_config", 404);
    if (result.error === "no_value") return fail("no_saved_address", 409);
    if (result.error === "too_many_attempts") {
      await deps.log({
        source: "web",
        level: "warn",
        event: "recap_email_code_refused",
        message: "Recap email code refused: too many attempts",
        userId,
        metadata: { kind: RECAP_EMAIL_KIND, reason: result.error },
      });
    }
    return fail(result.error, 400);
  }
  await deps.log({
    source: "web",
    event: "recap_email_confirmed",
    message: "Recap email address confirmed by code",
    userId,
    metadata: { kind: RECAP_EMAIL_KIND, by: "code" },
  });
  return NextResponse.json({ ok: true, recapEmailConfirmation: { state: "confirmed", at: result.at } });
}
