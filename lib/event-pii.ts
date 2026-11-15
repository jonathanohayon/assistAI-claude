// No third-party PII in clear in the `events` table (shown to tenants in
// Monitoring and to admins). Pure: no DB, no network — lib/logger.ts applies
// eventForStorage() to every row before it is inserted or mirrored to stdout,
// so worker events posted through /api/events are covered too.
//
// What is personal data here: a caller's phone number, a lead's number, the
// owner's WhatsApp number, any user's email address. They are stored as
//   - `<key>Hash`  : HMAC-SHA256 of the normalised value under a server key
//                    (derivedKey("event-pii-hash"): EVENT_PII_HASH_KEY if set,
//                    else HKDF of SECRETS_KEY, lib/crypto/derived-keys.ts),
//                    first 12 hex. Enough to correlate two events about the
//                    same person. Without any key it falls back to a plain
//                    sha256, which is pseudonymisation only (a phone number
//                    space can be enumerated).
//   - `<key>Last4` : the last 4 digits of a phone number, for display ("…1234").
// and masked inside free text ("…1234" for a number, "[email]" for an address).
//
// Allowed in clear (KEPT_KEY_PATHS): the tenant's OWN dialled line. It is
// not a third party's data and readers need it:
//   - lib/logger.ts resolves the tenant from metadata.toNumber /
//     metadata.origin.calledNumber (phone_numbers lookup);
//   - lib/calls/query.ts tells web sessions from calls by toNumber = '';
//   - /api/dashboard/call-metrics and the Monitoring view label SIP calls by it.

import { createHash, createHmac } from "node:crypto";

import { derivedKey } from "@/lib/crypto/derived-keys";
import { EMAIL_RE, KEPT_KEY_PATHS, PHONE_RE, last4, maskPii } from "@/lib/pii-mask";

// The masks (regexes, last4, maskPii) live in the client-safe lib/pii-mask.ts
// so Monitoring can apply the same rules to old events in the browser.
export { EMAIL_RE, KEPT_KEY_PATHS, PHONE_RE, last4, maskPii } from "@/lib/pii-mask";

const digits = (v: string) => v.replace(/\D/g, "");

/**
 * Hash of the normalised value (lower-cased email, digits-only phone), first
 * 12 hex. The key is derivedKey("event-pii-hash"), read at call time:
 *   - EVENT_PII_HASH_KEY set (non-blank) : HMAC-SHA256 under it (utf8 bytes,
 *                                          the same output as before);
 *   - else SECRETS_KEY set and valid     : HMAC-SHA256 under HKDF(SECRETS_KEY);
 *   - else                               : plain sha256, byte for byte the
 *                                          pre-key output.
 * Once a key exists, new hashes no longer match old ones for the same value
 * (and rotating it, or SECRETS_KEY, does the same). Accepted: these hashes
 * only spot repeats of the same person across events, nothing joins on them.
 * The key is never logged, printed or put in a response or an error.
 */
export function piiHash(value: string): string {
  const v = value.trim();
  const norm = v.includes("@") ? v.toLowerCase() : `+${digits(v)}`;
  const key = derivedKey("event-pii-hash");
  const h = key ? createHmac("sha256", key) : createHash("sha256");
  return h.update(norm, "utf8").digest("hex").slice(0, 12);
}

const isPhone = (v: string) => new RegExp(`^${PHONE_RE.source}$`).test(v.trim());
const isEmail = (v: string) => new RegExp(`^${EMAIL_RE.source}$`).test(v.trim());
const hasPii = (v: string) => new RegExp(EMAIL_RE.source).test(v) || new RegExp(PHONE_RE.source).test(v);

/** fromNumber → from, callerPhone → caller, ownerWhatsapp → owner, email → email. */
function baseName(key: string): string {
  const b = key.replace(/(Number|Phone|Whatsapp|WhatsApp|Wa|Email)$/, "");
  return b || key;
}

/**
 * Metadata with third-party PII replaced: a value that IS a phone number or an
 * email becomes `<base>Hash` (+ `<base>Last4` for a number); a value that
 * CONTAINS one (error text, prompt) is masked in place. Kept paths stay as is.
 */
export function scrubMetadata(meta: Record<string, unknown>, path = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const p = path ? `${path}.${key}` : key;
    if (KEPT_KEY_PATHS.includes(p)) {
      out[key] = value;
      continue;
    }
    // A raw LiveKit room name used as call id (workers before 2026-11-05) can
    // hold the caller's number: store its sha256/16 instead, the form the
    // Calls join already accepts (lib/calls/core.ts callKeys, hashCallId).
    // This MUST stay a plain, unkeyed sha256 (never piiHash / HMAC): the Calls
    // page matches it against hashCallId(calls.call_id), the SQL in
    // lib/calls/query.ts and the worker compute the same plain hash, so a
    // keyed hash here would silently break the join.
    if (key === "callId" && typeof value === "string" && hasPii(value)) {
      out[key] = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
      continue;
    }
    if (typeof value === "string" && (isPhone(value) || isEmail(value))) {
      const base = baseName(key);
      out[`${base}Hash`] = piiHash(value);
      if (isPhone(value) && last4(value)) out[`${base}Last4`] = last4(value);
      continue;
    }
    out[key] = scrubValue(value, p);
  }
  return out;
}

function scrubValue(value: unknown, path: string): unknown {
  if (typeof value === "string") return hasPii(value) ? maskPii(value) : value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, path));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return scrubMetadata(value as Record<string, unknown>, path);
  }
  return value;
}

/** The message + metadata as they may be stored in `events`. */
export function eventForStorage(ev: { message: string; metadata?: Record<string, unknown> }): {
  message: string;
  metadata: Record<string, unknown>;
} {
  return { message: maskPii(ev.message), metadata: scrubMetadata(ev.metadata ?? {}) };
}

/** Safe fields for a phone number: `<base>Hash` + `<base>Last4`, never the number. */
export function phoneFields(base: string, phone: string | null | undefined): Record<string, string> {
  const v = (phone ?? "").trim();
  if (!v) return {};
  const l4 = last4(v);
  return { [`${base}Hash`]: piiHash(v), ...(l4 ? { [`${base}Last4`]: l4 } : {}) };
}

/** Safe caller fields for an event: { fromHash, fromLast4 }, never the number. */
export function callerFields(fromNumber: string | null | undefined): { fromHash?: string; fromLast4?: string } {
  return phoneFields("from", fromNumber);
}

/** Safe email field for an event. */
export function emailFields(email: string | null | undefined): { emailHash?: string } {
  const v = (email ?? "").trim();
  return v ? { emailHash: piiHash(v) } : {};
}
