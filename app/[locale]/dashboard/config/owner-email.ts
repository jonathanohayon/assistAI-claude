/**
 * Owner post-call recap by email: the pure rules behind the card
 * (owner-email-card.tsx) and its save step in config-form.tsx.
 *
 * API (PR #297): GET/PUT /api/dashboard/notifications/email[?asUserId=]
 *   → { ownerRecapEmail: string, ownerRecapEmailEnabled: boolean }
 * A field absent from the PUT body keeps its stored value, so the body only
 * carries what the user changed. The switch is stored on its own: it is
 * never derived from the address (on with no address is allowed; nothing
 * is sent until both are set).
 *
 * No React, no fetch: scripts/tests/owner-email-card.test.ts drives it.
 */

export interface OwnerEmailSettings {
  ownerRecapEmail: string;
  ownerRecapEmailEnabled: boolean;
}

export const OWNER_EMAIL_DEFAULTS: OwnerEmailSettings = {
  ownerRecapEmail: "",
  ownerRecapEmailEnabled: false,
};

/** The settings route, scoped to the tenant an admin is viewing. */
export function ownerEmailUrl(asUserId?: string | null): string {
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  return `/api/dashboard/notifications/email${qs}`;
}

/** The test route (PR #300): body `{ to }`, the email's language in
 *  ?locale, and ?asUserId so an admin tests the tenant's address. */
export function ownerEmailTestUrl(locale: string, asUserId?: string | null): string {
  const qs = new URLSearchParams({ locale });
  if (asUserId) qs.set("asUserId", asUserId);
  return `/api/dashboard/notifications/email-test?${qs.toString()}`;
}

/** Same normalisation as the server (trimmed, lowercased). */
export const normalizeOwnerEmail = (v: string) => v.trim().toLowerCase();

/** The PUT body: only the fields that differ from the last loaded/saved
 *  values. An untouched field stays absent. Empty object = nothing to save. */
export function ownerEmailSaveBody(
  base: OwnerEmailSettings,
  current: OwnerEmailSettings,
): Partial<OwnerEmailSettings> {
  const body: Partial<OwnerEmailSettings> = {};
  if (normalizeOwnerEmail(current.ownerRecapEmail) !== normalizeOwnerEmail(base.ownerRecapEmail)) {
    body.ownerRecapEmail = current.ownerRecapEmail.trim();
  }
  if (current.ownerRecapEmailEnabled !== base.ownerRecapEmailEnabled) {
    body.ownerRecapEmailEnabled = current.ownerRecapEmailEnabled;
  }
  return body;
}

/** Message keys (DashboardConfig) for a refused save. The server's own text
 *  is never shown. */
export type OwnerEmailErrorKey =
  | "ownerEmailErrInvalid"
  | "ownerEmailErrSave"
  | "ownerEmailErrForbidden"
  | "ownerEmailErrNoConfig";

export function ownerEmailSaveError(status: number, body: unknown): OwnerEmailErrorKey {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (status === 400 && error === "invalid_email") return "ownerEmailErrInvalid";
  if (status === 403) return "ownerEmailErrForbidden";
  if (status === 404) return "ownerEmailErrNoConfig";
  // invalid_boolean / invalid_json: our own body was wrong; the user can
  // only retry. Same for 401, 5xx and network failures.
  return "ownerEmailErrSave";
}

export type OwnerEmailStateKey =
  | "ownerEmailStateOn"
  | "ownerEmailStateNeedsAddress"
  | "ownerEmailStateOff"
  | "ownerEmailStateUnsaved"
  | "ownerEmailStatePlanOff";

/** The plain-words state line. It describes what is SAVED, so it never
 *  claims an email goes out when it doesn't: unsaved edits say so first. */
export function ownerEmailStateKey(
  base: OwnerEmailSettings,
  current: OwnerEmailSettings,
  recapFeatureOn = true,
): OwnerEmailStateKey {
  if (Object.keys(ownerEmailSaveBody(base, current)).length > 0) return "ownerEmailStateUnsaved";
  if (!base.ownerRecapEmailEnabled) return "ownerEmailStateOff";
  if (!base.ownerRecapEmail.trim()) return "ownerEmailStateNeedsAddress";
  if (!recapFeatureOn) return "ownerEmailStatePlanOff";
  return "ownerEmailStateOn";
}

/** Why the Test button is disabled, or null when it can be used. The test
 *  goes to the SAVED address (what the recap will use). */
export type OwnerEmailTestBlockKey = "ownerEmailTestNeedsSaved" | "ownerEmailTestSaveFirst";

export function ownerEmailTestBlock(
  base: OwnerEmailSettings,
  current: OwnerEmailSettings,
): OwnerEmailTestBlockKey | null {
  if (!base.ownerRecapEmail.trim()) return "ownerEmailTestNeedsSaved";
  if (normalizeOwnerEmail(current.ownerRecapEmail) !== normalizeOwnerEmail(base.ownerRecapEmail)) {
    return "ownerEmailTestSaveFirst";
  }
  return null;
}

/** The test route's answers (PR #300), each mapped to one of our lines:
 *   200 { ok, id }                         → sent
 *   400 invalid_email                      → our invalid-address line
 *   401 unauthorized / 500 send_failed     → failed
 *   403 forbidden                          → no access to this account
 *   403 recipient_not_allowed              → only the account's saved address
 *   429 rate_limited + Retry-After (s)     → too many tests, wait N min
 *   500 not_configured                     → email sending not set up
 *  Anything else (network, unknown code) → failed. The server's text is
 *  never shown. */
export type OwnerEmailTestResultKey =
  | "ownerEmailTestSent"
  | "ownerEmailErrInvalid"
  | "ownerEmailTestFailed"
  | "ownerEmailErrForbidden"
  | "ownerEmailTestRecipientNotAllowed"
  | "ownerEmailTestRateLimited"
  | "ownerEmailTestRateLimitedNoTime"
  | "ownerEmailTestNotConfigured";

export interface OwnerEmailTestResult {
  key: OwnerEmailTestResultKey;
  /** Minutes to wait, rounded up (rate limited with a Retry-After only). */
  minutes?: number;
}

/** Retry-After in seconds → whole minutes, rounded up (at least 1).
 *  Null when the header is missing or not a positive number of seconds. */
export function retryAfterMinutes(header: string | null | undefined): number | null {
  if (header == null || !/^\s*\d+\s*$/.test(header)) return null;
  const sec = Number(header);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.max(1, Math.ceil(sec / 60));
}

export function ownerEmailTestResult(
  status: number,
  body: unknown,
  retryAfter?: string | null,
): OwnerEmailTestResult {
  const b = body && typeof body === "object" ? (body as { ok?: unknown; error?: unknown }) : {};
  if (status === 200 && b.ok === true) return { key: "ownerEmailTestSent" };
  if (status === 400 && b.error === "invalid_email") return { key: "ownerEmailErrInvalid" };
  if (status === 403 && b.error === "recipient_not_allowed") return { key: "ownerEmailTestRecipientNotAllowed" };
  if (status === 403 && b.error === "forbidden") return { key: "ownerEmailErrForbidden" };
  if (status === 429 && b.error === "rate_limited") {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null ? { key: "ownerEmailTestRateLimitedNoTime" } : { key: "ownerEmailTestRateLimited", minutes };
  }
  if (status === 500 && b.error === "not_configured") return { key: "ownerEmailTestNotConfigured" };
  return { key: "ownerEmailTestFailed" };
}

/** The switch: flips the flag only. The address is kept (switching off then
 *  on again doesn't lose it), unlike the WhatsApp card which clears its number. */
export const toggleOwnerEmail = (v: OwnerEmailSettings): OwnerEmailSettings => ({
  ...v,
  ownerRecapEmailEnabled: !v.ownerRecapEmailEnabled,
});

/** Typing: changes the address only. Clearing it never switches the recap off. */
export const setOwnerEmailAddress = (v: OwnerEmailSettings, address: string): OwnerEmailSettings => ({
  ...v,
  ownerRecapEmail: address,
});
