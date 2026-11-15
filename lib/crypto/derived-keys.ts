// Purpose keys derived from the ONE master secret (SECRETS_KEY) — SERVER-ONLY.
// Jonathan sets only SECRETS_KEY + SECRETS_KEY_ID (E1, lib/crypto/secret-box.ts);
// every other server key is derived from it here, one per purpose, so no
// purpose ever shares key material with another or with E1's sealing.
//
// Derivation: HKDF-SHA256 (RFC 5869, node:crypto hkdfSync)
//   ikm  = the CURRENT SECRETS_KEY bytes (32), parsed and validated by E1's
//          keyringFromEnv (a malformed key = not set, plus E1's alert)
//   salt = empty (fixed). The ikm is already a uniformly random 32-byte key,
//          so a salt adds nothing; empty keeps the derivation reproducible.
//   info = the purpose label, verbatim ("event-pii-hash", "contact-code-hash")
//   L    = 32 bytes
//
// Precedence, per purpose, read at CALL time (never cached):
//   1. the purpose's override env var, if set and non-blank, wins (its utf8
//      bytes are the key, exactly as EVENT_PII_HASH_KEY was used before);
//   2. else the HKDF-derived key, when SECRETS_KEY is set and valid;
//   3. else null: the caller keeps today's unkeyed behaviour, byte for byte.
//
// Rotation: rotating SECRETS_KEY changes BOTH derived keys at once.
//   - event-pii-hash: hashes of the same person before and after the
//     rotation no longer match (correlation across the rotation is lost;
//     nothing joins on these hashes, so accepted);
//   - contact-code-hash: codes in flight (10 min TTL) stop verifying and the
//     owner asks for a new one (accepted).
//   E1's sealed secrets are NOT affected: they keep using the keyring, with
//   SECRETS_KEY_PREVIOUS for reads. Nothing here derives from
//   SECRETS_KEY_PREVIOUS, on purpose: a derived key is only ever the current one.
//
// Key material is NEVER logged, printed, returned to a client or put in an
// error message. Callers use the Buffer as an HMAC key and nothing else.
import { hkdfSync } from "node:crypto";

import { currentKeyForDerivation } from "@/lib/crypto/secret-box";
// Installs E1's misconfigured-key reporter (the ONLY alert path for a bad
// SECRETS_KEY), so the hash paths alert exactly as seal / open do.
import "@/lib/crypto/unreadable-secret";

type Env = Record<string, string | undefined>;

export type KeyPurpose = "event-pii-hash" | "contact-code-hash";

/** The explicit override env var per purpose. */
export const OVERRIDE_ENV: Readonly<Record<KeyPurpose, string>> = Object.freeze({
  "event-pii-hash": "EVENT_PII_HASH_KEY",
  "contact-code-hash": "CONTACT_CODE_HASH_KEY",
});

const HKDF_SALT = Buffer.alloc(0);
const KEY_BYTES = 32;

/**
 * The key for `purpose` (override > HKDF(SECRETS_KEY) > null). null = no key:
 * the caller must behave exactly as before keys existed. Never throws.
 */
export function derivedKey(purpose: KeyPurpose, env: Env = process.env): Buffer | null {
  const override = env[OVERRIDE_ENV[purpose]];
  if (override && override.trim()) return Buffer.from(override, "utf8");
  const master = currentKeyForDerivation(env);
  if (!master) return null;
  return Buffer.from(hkdfSync("sha256", master, HKDF_SALT, purpose, KEY_BYTES));
}
