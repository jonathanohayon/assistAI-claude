/**
 * Retry-After (seconds) → whole minutes to show the user, rounded up.
 *
 * Shared by the dashboard "Test" buttons that hit rate-limited routes
 * (WhatsApp test today; the owner email card carries its own copy on
 * fe/owner-email-card and can switch to this one once both are merged).
 *
 * Client-safe: no server dependency.
 */

/** At least 1. Null when the header is missing or not a positive whole
 *  number of seconds (an HTTP-date is not used by our routes). */
export function retryAfterMinutes(header: string | null | undefined): number | null {
  if (header == null || !/^\s*\d+\s*$/.test(header)) return null;
  const sec = Number(header);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.max(1, Math.ceil(sec / 60));
}
