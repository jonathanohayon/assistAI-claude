// "Test WhatsApp" button (dashboard config): one test message to the
// account's OWN saved owner number, nothing else.
//
// Framework-free so scripts/tests/whatsapp-test-route*.test.ts can drive it
// with an injected sender (no provider call, ever, in tests). The route
// (app/api/dashboard/notifications/whatsapp-test/route.ts) only resolves the
// session scope and wires the real dependencies.
//
// Rules (security P0):
//   - Recipient = agent_configs.owner_whatsapp of the scoped account (admin:
//     ?asUserId=<tenant> → that tenant's saved number). A `to` in the body is
//     only accepted when it IS that number (E.164 compare).
//   - Rate-limited in the DB: 5 per rolling hour per account + a global
//     ceiling, counted before the send.
//   - No user-controlled text in free-form messages sent on our sender. The
//     display name only goes in a template variable, sanitised and capped.
//   - Neutral error codes only; raw provider errors are logged server-side,
//     with any phone number redacted.

import { normalizeE164 } from "@/lib/phone-utils";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import type { WhatsAppOptions, WhatsAppResult } from "@/lib/whatsapp";

export const WHATSAPP_TEST_LIMITS = {
  bucket: "whatsapp_test",
  windowMs: 60 * 60_000,
  perAccount: 5,
  /** All accounts together, per rolling hour. */
  global: 50,
} as const;

/** Max length of the display name placed in a template variable. */
export const NAME_MAX = 40;

export type WhatsAppTestErrorCode =
  | "invalid_number"
  | "recipient_not_allowed"
  | "no_saved_number"
  | "rate_limited"
  | "send_failed"
  | "not_configured";

/** Free-form body: fixed copy, never any user-controlled content. */
export const FIXED_TEST_TEXT =
  "🔔 *Tamara — Test notification*\n\nCeci est un test depuis ton dashboard.\nSi tu lis ce message, les notifications WhatsApp sont opérationnelles ✓";

export type WhatsAppTestDeps = {
  /** The account's saved owner number (agent_configs.owner_whatsapp), "" / null when none. */
  loadSavedNumber(userId: string): Promise<string | null>;
  consumeRateLimit(opts: {
    bucket: string;
    accountId: string;
    windowMs: number;
    perAccount: number;
    global: number;
  }): Promise<RateLimitResult>;
  /** True when a WhatsApp sender is configured server-side. */
  isConfigured(): boolean;
  /** Owner template id, when one is configured. */
  templateSid(): string | undefined;
  send(opts: WhatsAppOptions): Promise<WhatsAppResult>;
  /** Server-side log of a failed send; receives an already-redacted error. */
  logFailure(redactedError: string, userId: string): Promise<void> | void;
};

export type WhatsAppTestResponse = {
  status: number;
  body: { ok: true } | { error: WhatsAppTestErrorCode; scope?: "account" | "global" };
  headers?: Record<string, string>;
};

const E164_LOOSE = /^\+?\d{6,15}$/;
const clean = (s: string) => s.trim().replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");

/**
 * Display name for a template variable: control/format characters (incl.
 * newlines, tabs, bidi overrides) removed, spaces collapsed, at most
 * NAME_MAX characters. "" when nothing printable is left.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const printable = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(printable).slice(0, NAME_MAX).join("").trim();
}

/** Template variable {{1}}: fixed copy, plus the capped name when there is one. */
export function templateGreeting(name: string): string {
  return name
    ? `Bonjour ${name}, ceci est un test Tamara : les notifications WhatsApp sont opérationnelles ✓`
    : "Ceci est un test Tamara : les notifications WhatsApp sont opérationnelles ✓";
}

/** Replaces anything that looks like a phone number before logging. */
export function redactNumbers(s: string): string {
  return s.replace(/\+?\d[\d\s().-]{4,}\d/g, "[number]");
}

export async function runWhatsAppTest(
  input: { userId: string; displayName: string | null; body: unknown },
  deps: WhatsAppTestDeps,
): Promise<WhatsAppTestResponse> {
  const fail = (status: number, error: WhatsAppTestErrorCode): WhatsAppTestResponse => ({
    status,
    body: { error },
  });

  // 1. The saved number is the only possible recipient.
  const savedRaw = clean((await deps.loadSavedNumber(input.userId)) ?? "");
  if (!savedRaw || !E164_LOOSE.test(savedRaw)) return fail(409, "no_saved_number");
  const saved = normalizeE164(savedRaw);

  // 2. A `to` in the body must be that same number.
  const b = input.body && typeof input.body === "object" && !Array.isArray(input.body)
    ? (input.body as Record<string, unknown>)
    : {};
  if (b.to !== undefined && b.to !== null && b.to !== "") {
    if (typeof b.to !== "string") return fail(400, "invalid_number");
    const to = clean(b.to);
    if (!E164_LOOSE.test(to)) return fail(400, "invalid_number");
    if (normalizeE164(to) !== saved) return fail(403, "recipient_not_allowed");
  }

  // 3. No sender configured → nothing to count.
  if (!deps.isConfigured()) return fail(503, "not_configured");

  // 4. Limits (atomic in the DB; the attempt is counted when ok).
  const limit = await deps.consumeRateLimit({
    bucket: WHATSAPP_TEST_LIMITS.bucket,
    accountId: input.userId,
    windowMs: WHATSAPP_TEST_LIMITS.windowMs,
    perAccount: WHATSAPP_TEST_LIMITS.perAccount,
    global: WHATSAPP_TEST_LIMITS.global,
  });
  if (!limit.ok) {
    return {
      status: 429,
      body: { error: "rate_limited", scope: limit.scope },
      headers: { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSec))) },
    };
  }

  // 5. Send. Free-form body = fixed copy (also what a template fallback
  //    falls back to); the name only ever goes in template variable {{1}}.
  const templateSid = deps.templateSid();
  const name = sanitizeDisplayName(input.displayName);
  let result: WhatsAppResult;
  try {
    result = await deps.send({
      to: saved,
      body: FIXED_TEST_TEXT,
      ...(templateSid ? { templateSid, templateVariables: { "1": templateGreeting(name) } } : {}),
      ownerTemplateFallback: true,
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!result.ok) {
    await deps.logFailure(redactNumbers(result.error ?? "unknown"), input.userId);
    return fail(502, "send_failed");
  }
  return { status: 200, body: { ok: true } };
}
