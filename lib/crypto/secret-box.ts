// Secrets at rest (E1) — SERVER-ONLY. AES-256-GCM, one random 12-byte IV per
// value, and the KEY ID inside every value so keys can rotate.
//
// Stored format (self-describing, ASCII):
//   enc:v1:<kid>:<iv b64url>:<tag b64url>:<ciphertext b64url>
// "enc:v1:<kid>" is bound as GCM additional data: changing the kid (or the
// version) of a stored value fails its tag, like any other tampering.
//
// Keys (web service ONLY, set by hand — never generated or committed here):
//   SECRETS_KEY / SECRETS_KEY_ID                    — seals new writes, reads
//   SECRETS_KEY_PREVIOUS / SECRETS_KEY_PREVIOUS_ID  — reads only (rotation)
// A key is base64 (or base64url) of exactly 32 bytes; an id is 1–32 of
// [A-Za-z0-9_-]. A malformed key counts as NOT set.
//
// Rules: a read accepts plain AND sealed values (plain is returned as is).
// A new write is sealed only when SECRETS_KEY is set (no key = today's
// behaviour, plain). A sealed value that can't be opened — no key, unknown
// kid, wrong key, tampered — is NEVER partially returned: openSecret says
// { ok: false } and the caller treats the secret as absent. Nothing here
// throws on a read.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

const PREFIX = "enc:";
const V1 = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export type OpenFailure = "no_key" | "unknown_kid" | "malformed" | "unsupported_version" | "auth_failed";
export type OpenResult = { ok: true; value: string } | { ok: false; reason: OpenFailure };

export interface Keyring {
  /** The key new writes are sealed with; null = writes stay plain. */
  current: { kid: string; key: Buffer } | null;
  /** Every key a read may use (current + previous), by id. */
  byId: Map<string, Buffer>;
  /** Configuration problems, by env var NAME only (never a value). */
  problems: string[];
}

function decodeKey(raw: string): Buffer | null {
  const s = raw.trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.length === 32 ? buf : null;
}

function readKey(env: Env, keyVar: string, idVar: string, problems: string[]): { kid: string; key: Buffer } | null {
  const rawKey = (env[keyVar] ?? "").trim();
  const kid = (env[idVar] ?? "").trim();
  if (!rawKey && !kid) return null;
  const key = rawKey ? decodeKey(rawKey) : null;
  if (!rawKey) problems.push(`${keyVar} is missing (${idVar} is set)`);
  else if (!key) problems.push(`${keyVar} must be base64 of exactly 32 bytes`);
  if (!kid) problems.push(`${idVar} is missing (${keyVar} is set)`);
  else if (!KID_RE.test(kid)) problems.push(`${idVar} must be 1-32 characters [A-Za-z0-9_-]`);
  return key && KID_RE.test(kid) ? { kid, key } : null;
}

export function keyringFromEnv(env: Env = process.env): Keyring {
  const problems: string[] = [];
  const current = readKey(env, "SECRETS_KEY", "SECRETS_KEY_ID", problems);
  const previous = readKey(env, "SECRETS_KEY_PREVIOUS", "SECRETS_KEY_PREVIOUS_ID", problems);
  const byId = new Map<string, Buffer>();
  if (previous) byId.set(previous.kid, previous.key);
  if (current) byId.set(current.kid, current.key); // the current key wins a shared id
  return { current, byId, problems };
}

// ── A misconfigured key must be LOUD ───────────────────────────────────
// keyringFromEnv stays pure; the seal / open entry points report its
// problems (env var NAMES and what is wrong, never a value) to ONE reporter,
// which alerts the admins once (lib/crypto/unreadable-secret.ts installs the
// default; tests install their own).

export type KeyProblemReporter = (problems: string[]) => void;
let keyProblemReporter: KeyProblemReporter | null = null;

export function setKeyProblemReporter(r: KeyProblemReporter | null): void {
  keyProblemReporter = r;
}

/** The keyring for a seal / open attempt; problems (if any) are reported, never thrown. */
function ringForUse(env: Env): Keyring {
  const ring = keyringFromEnv(env);
  if (ring.problems.length && keyProblemReporter) {
    try {
      keyProblemReporter(ring.problems);
    } catch {
      // reporting must never break a read or a write
    }
  }
  return ring;
}

const b64u = (b: Buffer) => b.toString("base64url");
const aad = (kid: string) => Buffer.from(`${PREFIX}${V1}:${kid}`, "utf8");

/** True for a value in the sealed format (any version) — such a value is never used as is. */
export function isSealed(stored: unknown): stored is string {
  return typeof stored === "string" && stored.startsWith(PREFIX) && /^enc:v\d+:/.test(stored);
}

/** Whether new writes are sealed under this environment. */
export function sealingEnabled(env: Env = process.env): boolean {
  return ringForUse(env).current !== null;
}

/** Seals with the current key. Throws when no key is set: use sealForStorage on write paths. */
export function sealSecret(plain: string, env: Env = process.env): string {
  const { current } = ringForUse(env);
  if (!current) throw new Error("SECRETS_KEY is not set");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(current.kid));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${V1}:${current.kid}:${b64u(iv)}:${b64u(cipher.getAuthTag())}:${b64u(ct)}`;
}

/** The value a write stores: sealed when SECRETS_KEY is set, else the plain value (E1 = today without a key). */
export function sealForStorage(plain: string, env: Env = process.env): string {
  return sealingEnabled(env) ? sealSecret(plain, env) : plain;
}

/** Plain → as is. Sealed → the plain value, or { ok: false } (never a partial value). Never throws. */
export function openSecret(stored: string, env: Env = process.env): OpenResult {
  const ring = ringForUse(env);
  if (!isSealed(stored)) return { ok: true, value: stored };
  const parts = stored.split(":");
  if (parts[1] !== V1) return { ok: false, reason: "unsupported_version" };
  if (parts.length !== 6) return { ok: false, reason: "malformed" };
  const [, , kid, ivS, tagS, ctS] = parts;
  if (!KID_RE.test(kid) || ![ivS, tagS, ctS].every((p) => B64URL_RE.test(p))) return { ok: false, reason: "malformed" };
  const iv = Buffer.from(ivS, "base64url");
  const tag = Buffer.from(tagS, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return { ok: false, reason: "malformed" };
  if (ring.byId.size === 0) return { ok: false, reason: "no_key" };
  const key = ring.byId.get(kid);
  if (!key) return { ok: false, reason: "unknown_kid" };
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(kid));
    decipher.setAuthTag(tag);
    // final() verifies the tag: until it returns, nothing is handed out.
    const out = Buffer.concat([decipher.update(Buffer.from(ctS, "base64url")), decipher.final()]);
    return { ok: true, value: out.toString("utf8") };
  } catch {
    return { ok: false, reason: "auth_failed" };
  }
}

/** Refusal for a secret a request PROVIDES already in the sealed format (it would read as unreadable). */
export const SEALED_SECRET_REFUSED_MESSAGE = "This secret is not accepted. Enter the secret itself.";

export function sealedSecretRefusal(
  provided: unknown,
  field: string,
): { error: "invalid_secret"; message: string; fields: string[] } | null {
  return typeof provided === "string" && isSealed(provided.trim())
    ? { error: "invalid_secret", message: SEALED_SECRET_REFUSED_MESSAGE, fields: [field] }
    : null;
}
