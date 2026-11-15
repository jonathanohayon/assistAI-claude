/**
 * Confirming the owner recap email address with a 6-digit code (verified
 * contacts N2): the pure rules behind the confirmation row of
 * owner-email-card.tsx.
 *
 * API (PR #348), all three scoped by ?asUserId for an admin:
 *   GET  /api/dashboard/notifications/email
 *        → recapEmailConfirmation: { state: "confirmed" | "unconfirmed", at? } | null
 *          (null = no saved address; confirmed without `at` = grandfathered)
 *   POST /api/dashboard/notifications/email/code      (no body: the SAVED address)
 *   POST /api/dashboard/notifications/email/confirm   { code }
 *
 * Enforcement is OFF: recaps are sent whether the address is confirmed or
 * not, so nothing here may say otherwise. The server's text is never shown;
 * every answer maps to one of our message keys (DashboardConfig).
 *
 * No React, no fetch: scripts/tests/owner-email-confirm.test.ts drives it.
 */

import { retryAfterMinutes } from "@/lib/retry-after";

import { normalizeOwnerEmail, type OwnerEmailSettings } from "./owner-email";

export type RecapEmailConfirmation = { state: "confirmed" | "unconfirmed"; at?: string } | null;

/** The GET field, defensively read: anything unexpected counts as "no state". */
export function parseRecapEmailConfirmation(raw: unknown): RecapEmailConfirmation {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { state?: unknown; at?: unknown };
  if (r.state !== "confirmed" && r.state !== "unconfirmed") return null;
  return typeof r.at === "string" && r.at ? { state: r.state, at: r.at } : { state: r.state };
}

function scoped(path: string, asUserId?: string | null): string {
  return asUserId ? `${path}?asUserId=${encodeURIComponent(asUserId)}` : path;
}
export const ownerEmailCodeUrl = (asUserId?: string | null) =>
  scoped("/api/dashboard/notifications/email/code", asUserId);
export const ownerEmailConfirmUrl = (asUserId?: string | null) =>
  scoped("/api/dashboard/notifications/email/confirm", asUserId);

export const CODE_LENGTH = 6;
/** One optional space ("123 456"). */
export const CODE_INPUT_MAX_LENGTH = 7;

/** The code as sent to the server: a STRING (leading zeros kept), spaces removed. */
export const cleanCode = (raw: string) => raw.replace(/\s+/g, "");
export const isCompleteCode = (raw: string) => /^\d{6}$/.test(cleanCode(raw));

export type ConfirmBadge =
  | { key: "ownerEmailConfirmStateUnconfirmed" }
  | { key: "ownerEmailConfirmStateConfirmedOn"; date: string }
  | { key: "ownerEmailConfirmStateConfirmed" };

/** The date in the page locale; null when `at` is missing or unreadable. */
export function formatConfirmedAt(at: string | undefined, locale: string): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d);
  } catch {
    return null;
  }
}

/** The state of the SAVED address, or null (nothing saved: no badge). */
export function confirmBadge(conf: RecapEmailConfirmation, locale: string): ConfirmBadge | null {
  if (!conf) return null;
  if (conf.state === "unconfirmed") return { key: "ownerEmailConfirmStateUnconfirmed" };
  const date = formatConfirmedAt(conf.at, locale);
  return date ? { key: "ownerEmailConfirmStateConfirmedOn", date } : { key: "ownerEmailConfirmStateConfirmed" };
}

/** Why "Send a code" is disabled, or null. Same rule as Test: the code goes
 *  to the SAVED address, so a typed address that differs blocks it. */
export type ConfirmSendBlockKey = "ownerEmailConfirmNeedsSaved" | "ownerEmailConfirmSaveFirst";
export function confirmSendBlock(base: OwnerEmailSettings, current: OwnerEmailSettings): ConfirmSendBlockKey | null {
  if (!base.ownerRecapEmail.trim()) return "ownerEmailConfirmNeedsSaved";
  if (normalizeOwnerEmail(current.ownerRecapEmail) !== normalizeOwnerEmail(base.ownerRecapEmail)) {
    return "ownerEmailConfirmSaveFirst";
  }
  return null;
}

/** Why "Confirm" is disabled, or null. */
export type ConfirmSubmitBlockKey = "ownerEmailConfirmCodeIncomplete";
export const confirmSubmitBlock = (code: string): ConfirmSubmitBlockKey | null =>
  isCompleteCode(code) ? null : "ownerEmailConfirmCodeIncomplete";

export type ConfirmErrorKey =
  | "ownerEmailErrForbidden"
  | "ownerEmailErrNoConfig"
  | "ownerEmailConfirmErrNoSavedAddress"
  | "ownerEmailConfirmErrRateLimited"
  | "ownerEmailConfirmErrRateLimitedNoTime"
  | "ownerEmailConfirmErrNotConfigured"
  | "ownerEmailConfirmErrSendFailed"
  | "ownerEmailConfirmErrInvalidCode"
  | "ownerEmailConfirmErrExpired"
  | "ownerEmailConfirmErrTooManyAttempts"
  | "ownerEmailConfirmErrConfirmFailed";

export type SendOutcome =
  | { kind: "sent"; minutes: number }
  /** 409 already_confirmed: reload the state (it reads confirmed). */
  | { kind: "alreadyConfirmed" }
  | { kind: "error"; key: ConfirmErrorKey; minutes?: number };

const errorOf = (body: unknown) =>
  body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;

/** POST .../code answers → our outcome. */
export function sendCodeOutcome(status: number, body: unknown, retryAfter?: string | null): SendOutcome {
  const error = errorOf(body);
  if (status === 200 && (body as { ok?: unknown } | null)?.ok === true) {
    const sec = (body as { expiresInSec?: unknown }).expiresInSec;
    const minutes = typeof sec === "number" && sec > 0 ? Math.max(1, Math.round(sec / 60)) : 10;
    return { kind: "sent", minutes };
  }
  if (status === 409 && error === "already_confirmed") return { kind: "alreadyConfirmed" };
  if (status === 409 && error === "no_saved_address") return { kind: "error", key: "ownerEmailConfirmErrNoSavedAddress" };
  if (status === 404) return { kind: "error", key: "ownerEmailErrNoConfig" };
  if (status === 403) return { kind: "error", key: "ownerEmailErrForbidden" };
  if (status === 429) {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null
      ? { kind: "error", key: "ownerEmailConfirmErrRateLimitedNoTime" }
      : { kind: "error", key: "ownerEmailConfirmErrRateLimited", minutes };
  }
  if (status === 503 && error === "not_configured") return { kind: "error", key: "ownerEmailConfirmErrNotConfigured" };
  // 500 send_failed, 401, network, unknown: the send didn't go through.
  return { kind: "error", key: "ownerEmailConfirmErrSendFailed" };
}

export type ConfirmOutcome =
  | { kind: "confirmed"; confirmation: RecapEmailConfirmation }
  /** `resend`: the code is dead, offer "Send a new code". */
  | { kind: "error"; key: ConfirmErrorKey; resend: boolean };

/** POST .../confirm answers → our outcome. */
export function confirmCodeOutcome(status: number, body: unknown): ConfirmOutcome {
  const error = errorOf(body);
  if (status === 200 && (body as { ok?: unknown } | null)?.ok === true) {
    const parsed = parseRecapEmailConfirmation((body as { recapEmailConfirmation?: unknown }).recapEmailConfirmation);
    return { kind: "confirmed", confirmation: parsed ?? { state: "confirmed" } };
  }
  if (status === 400 && error === "invalid_code") return { kind: "error", key: "ownerEmailConfirmErrInvalidCode", resend: false };
  if (status === 400 && error === "code_expired") return { kind: "error", key: "ownerEmailConfirmErrExpired", resend: true };
  if (status === 400 && error === "too_many_attempts") return { kind: "error", key: "ownerEmailConfirmErrTooManyAttempts", resend: true };
  if (status === 409 && error === "no_saved_address") return { kind: "error", key: "ownerEmailConfirmErrNoSavedAddress", resend: false };
  if (status === 404) return { kind: "error", key: "ownerEmailErrNoConfig", resend: false };
  if (status === 403) return { kind: "error", key: "ownerEmailErrForbidden", resend: false };
  return { kind: "error", key: "ownerEmailConfirmErrConfirmFailed", resend: false };
}
