// Verified contacts, N2: the confirmation CODE itself (pure: no database, no
// I/O besides node:crypto; the only env read is the pepper, via
// lib/crypto/derived-keys.ts). Kind-generic so the owner WhatsApp and
// the transfer number channels (held) reuse it; only "owner_recap_email" has
// a sending channel today (lib/recap-email-code/*).
//
// - 6 digits, crypto-random (randomInt), valid CODE_TTL_MS, MAX_ATTEMPTS
//   tries; a code whose tries are used up is dead.
// - NEVER stored in clear: the row holds a hash of the code bound to the
//   account, the kind, the normalised value and a per-code salt (codeHash):
//   HMAC-SHA256 under a server pepper (derivedKey("contact-code-hash"):
//   CONTACT_CODE_HASH_KEY if set, else HKDF of SECRETS_KEY) when one exists,
//   else the plain salted sha256 of N2. Plus the sha256 of the normalised
//   value (valueKey) so a value change makes the row stale. Never logged,
//   never in a response.
// - ONE live code per (account, kind): a new send replaces the row
//   (contact_confirmation_codes, primary key (user_id, kind)).
// The DB side: lib/contact-code-store.ts.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { derivedKey } from "@/lib/crypto/derived-keys";
import { normaliseContactValue, type ContactKind } from "@/lib/contact-confirmation";

export const CODE_LENGTH = 6;
/** A code is valid 10 minutes. */
export const CODE_TTL_MS = 10 * 60_000;
/** Wrong tries a code survives: the 5th wrong try kills it. */
export const MAX_ATTEMPTS = 5;

/** A fresh 6-digit code ("000000"–"999999"), uniformly random. */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** A fresh per-code salt (hex). */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/** The code as typed, reduced to its digits when it is exactly 6 of them (spaces allowed), else null. */
export function parseCodeInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, "");
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(v) ? v : null;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * sha256 (hex) of the NORMALISED value: the rate-limit key per value and
 * the row's value_hash. Never the value itself.
 */
export function valueKey(kind: ContactKind, value: string): string {
  return sha256(normaliseContactValue(kind, value));
}

/**
 * The stored hash of `code`, bound to the account, the kind, the normalised
 * value and the salt. Issue AND verify both go through here, so they always
 * apply the same rule, read at call time:
 *   - a pepper exists (CONTACT_CODE_HASH_KEY, else HKDF(SECRETS_KEY)):
 *     HMAC-SHA256(pepper, material), so a leaked row can't be brute-forced
 *     over the 10^6 codes without the server secret;
 *   - no pepper: sha256(material), byte for byte N2's hash.
 * A code issued under one rule fails to verify under another: codes in
 * flight when the pepper appears or rotates (SECRETS_KEY rotation included)
 * answer invalid_code and the owner asks for a new one. Accepted: a code
 * lives 10 minutes, so stored rows need no migration.
 */
export function hashCode(input: { userId: string; kind: ContactKind; value: string; salt: string; code: string }): string {
  const v = normaliseContactValue(input.kind, input.value);
  const material = ["contact-code:v1", input.userId, input.kind, v, input.salt, input.code].join("\u0000");
  const pepper = derivedKey("contact-code-hash");
  return pepper ? createHmac("sha256", pepper).update(material, "utf8").digest("hex") : sha256(material);
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A stored code row, as the confirm step reads it (under a row lock). */
export interface StoredCode {
  valueHash: string;
  salt: string;
  codeHash: string;
  attempts: number;
  /** The database clock says expires_at is past. */
  expired: boolean;
}

export type ConfirmError = "invalid_code" | "code_expired" | "too_many_attempts";

export type ConfirmDecision =
  /** The code matches: confirm the value, delete the row. */
  | { outcome: "confirmed" }
  /** Refused; `write` says what to do with the row. */
  | { outcome: "refused"; error: ConfirmError; write: "none" | "delete" | { attempts: number } };

/**
 * THE confirm decision for a typed code against the account's live row.
 * `currentValue` = the value stored NOW for the kind.
 * - no row → invalid_code (whether a code exists is not revealed);
 * - row for another value (the value changed since) → invalid_code, row deleted;
 * - tries used up → too_many_attempts (the code is dead, even the right one);
 * - expired → code_expired, row deleted;
 * - wrong code → one try counted; the try that uses the last one answers
 *   too_many_attempts;
 * - right code → confirmed.
 */
export function decideConfirm(
  row: StoredCode | null,
  input: { userId: string; kind: ContactKind; currentValue: string; code: string },
): ConfirmDecision {
  if (!row) return { outcome: "refused", error: "invalid_code", write: "none" };
  if (!sameHash(row.valueHash, valueKey(input.kind, input.currentValue))) {
    return { outcome: "refused", error: "invalid_code", write: "delete" };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { outcome: "refused", error: "too_many_attempts", write: "none" };
  if (row.expired) return { outcome: "refused", error: "code_expired", write: "delete" };
  const typed = hashCode({ userId: input.userId, kind: input.kind, value: input.currentValue, salt: row.salt, code: input.code });
  if (sameHash(typed, row.codeHash)) return { outcome: "confirmed" };
  const attempts = row.attempts + 1;
  return {
    outcome: "refused",
    error: attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code",
    write: { attempts },
  };
}
