// Client-safe half of lib/event-pii.ts: the masks only (no hashing, no I/O),
// so the browser can apply the storage rules to events stored before them.
// lib/event-pii.ts re-exports everything here; change the rules in one place.

/** Metadata paths whose value is the tenant's own line, kept in clear. */
export const KEPT_KEY_PATHS: readonly string[] = ["toNumber", "tenantLine", "origin.calledNumber"];

/** Email addresses anywhere in a string. */
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** International phone numbers (E.164, optionally spaced/dashed, optional whatsapp: prefix). */
export const PHONE_RE = /(?:whatsapp:)?\+[1-9](?:[\s().-]?\d){6,14}/g;

const digits = (v: string) => v.replace(/\D/g, "");

/** Last 4 digits of a phone number ("" when it has fewer than 4). */
export function last4(phone: string): string {
  const d = digits(phone);
  return d.length >= 4 ? d.slice(-4) : "";
}

/** Free text with every email address and phone number masked. */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, (m) => (last4(m) ? `…${last4(m)}` : "[phone]"));
}
