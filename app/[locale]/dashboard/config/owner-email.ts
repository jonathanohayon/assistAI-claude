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

/** The test route: it takes `{ to }`, not a tenant scope. */
export function ownerEmailTestUrl(locale: string): string {
  return `/api/dashboard/notifications/email-test?locale=${encodeURIComponent(locale)}`;
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

/** The test route answers `{ ok, fallback }`: with no sender configured it
 *  only logs the email server side (`fallback: "console_log"`), so that is
 *  NOT a sent email. */
export type OwnerEmailTestResultKey =
  | "ownerEmailTestSent"
  | "ownerEmailTestNotConfigured"
  | "ownerEmailTestFailed";

export function ownerEmailTestResult(status: number, body: unknown): OwnerEmailTestResultKey {
  const b = body && typeof body === "object" ? (body as { ok?: unknown; fallback?: unknown }) : {};
  if (status !== 200 || b.ok !== true) return "ownerEmailTestFailed";
  if (b.fallback) return "ownerEmailTestNotConfigured";
  return "ownerEmailTestSent";
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
