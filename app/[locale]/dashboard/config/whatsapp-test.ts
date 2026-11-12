/**
 * Owner WhatsApp card, "Test" button: the pure rules behind it
 * (notif-channel-card.tsx, rendered by notifs-panel.tsx).
 *
 * API (PR #301): POST /api/dashboard/notifications/whatsapp-test[?asUserId=]
 * The test only ever goes to the SAVED owner number (an admin with
 * ?asUserId tests that tenant's saved number). A `to` in the body must be
 * that same number. Server logic: lib/notifications/whatsapp-test.ts.
 *
 * No React, no fetch: scripts/tests/whatsapp-test-codes.test.ts drives it.
 */

import { normalizeE164 } from "@/lib/phone-utils";
import { retryAfterMinutes } from "@/lib/retry-after";

export const WHATSAPP_TEST_PATH = "/api/dashboard/notifications/whatsapp-test";

/** The test route, scoped to the tenant an admin is viewing. */
export function whatsappTestUrl(asUserId?: string | null): string {
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  return `${WHATSAPP_TEST_PATH}${qs}`;
}

// Same cleaning and shape check as the server (whatsapp-test.ts and the
// config PUT): trimmed, "whatsapp:" prefix and spaces/()/- removed.
const E164_LOOSE = /^\+?\d{6,15}$/;
const clean = (s: string) => s.trim().replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");

/** True when the two inputs are the same number once normalised. */
export function sameWhatsappNumber(a: string, b: string): boolean {
  const ca = clean(a);
  const cb = clean(b);
  if (!ca || !cb) return false;
  return normalizeE164(ca) === normalizeE164(cb);
}

/** Why the Test button is disabled, or null when it can be used. */
export type WhatsappTestBlockKey = "whatsappTestNeedsSaved" | "whatsappTestSaveFirst";

export function whatsappTestBlock(saved: string, current: string): WhatsappTestBlockKey | null {
  const s = clean(saved);
  if (!s || !E164_LOOSE.test(s)) return "whatsappTestNeedsSaved";
  if (!sameWhatsappNumber(saved, current)) return "whatsappTestSaveFirst";
  return null;
}

/** The route's answers, each mapped to one of our lines. The server's text
 *  is never shown:
 *   200 { ok: true }                         → sent
 *   400 invalid_number                       → invalid number
 *   401 Unauthorized                         → session expired
 *   403 Forbidden                            → no access to this account
 *   403 recipient_not_allowed                → only the saved number
 *   409 no_saved_number                      → save a number first
 *   429 rate_limited (+ Retry-After seconds) → too many tests, wait N min
 *   502 send_failed                          → not sent, try again
 *   503 not_configured                       → WhatsApp sending not set up
 *  Anything else (network, unknown code)     → failed. */
export type WhatsappTestResultKey =
  | "whatsappTestSent"
  | "whatsappTestInvalidNumber"
  | "whatsappTestUnauthorized"
  | "whatsappTestForbidden"
  | "whatsappTestRecipientNotAllowed"
  | "whatsappTestNoSavedNumber"
  | "whatsappTestRateLimited"
  | "whatsappTestRateLimitedNoTime"
  | "whatsappTestSendFailed"
  | "whatsappTestNotConfigured"
  | "whatsappTestFailed";

export interface WhatsappTestResult {
  key: WhatsappTestResultKey;
  /** Minutes to wait, rounded up (rate limited with a Retry-After only). */
  minutes?: number;
}

export function whatsappTestResult(
  status: number,
  body: unknown,
  retryAfter?: string | null,
): WhatsappTestResult {
  const b = body && typeof body === "object" ? (body as { ok?: unknown; error?: unknown }) : {};
  if (status === 200 && b.ok === true) return { key: "whatsappTestSent" };
  if (status === 400 && b.error === "invalid_number") return { key: "whatsappTestInvalidNumber" };
  if (status === 401) return { key: "whatsappTestUnauthorized" };
  if (status === 403 && b.error === "recipient_not_allowed") return { key: "whatsappTestRecipientNotAllowed" };
  if (status === 403) return { key: "whatsappTestForbidden" };
  if (status === 409 && b.error === "no_saved_number") return { key: "whatsappTestNoSavedNumber" };
  if (status === 429 && b.error === "rate_limited") {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null ? { key: "whatsappTestRateLimitedNoTime" } : { key: "whatsappTestRateLimited", minutes };
  }
  if (status === 502 && b.error === "send_failed") return { key: "whatsappTestSendFailed" };
  if (status === 503 && b.error === "not_configured") return { key: "whatsappTestNotConfigured" };
  return { key: "whatsappTestFailed" };
}

/** Every message key this card can show (block reasons + results). */
export const WHATSAPP_TEST_KEYS: readonly (WhatsappTestBlockKey | WhatsappTestResultKey)[] = [
  "whatsappTestNeedsSaved",
  "whatsappTestSaveFirst",
  "whatsappTestSent",
  "whatsappTestInvalidNumber",
  "whatsappTestUnauthorized",
  "whatsappTestForbidden",
  "whatsappTestRecipientNotAllowed",
  "whatsappTestNoSavedNumber",
  "whatsappTestRateLimited",
  "whatsappTestRateLimitedNoTime",
  "whatsappTestSendFailed",
  "whatsappTestNotConfigured",
  "whatsappTestFailed",
];
