// Unit tests for lib/crypto/derived-keys.ts: the event-hash key and the
// contact-code pepper, derived from SECRETS_KEY (HKDF-SHA256), with optional
// per-purpose overrides, and today's unkeyed behaviour when nothing is set.
// Mock keys only (fixed byte patterns): no real key is ever used or committed.
// Run with:  npx tsx scripts/tests/derived-keys.test.ts
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import { decideConfirm, hashCode, valueKey, type StoredCode } from "../../lib/contact-code";
import type { ContactKind } from "../../lib/contact-confirmation";
import { derivedKey, OVERRIDE_ENV, type KeyPurpose } from "../../lib/crypto/derived-keys";
import { setKeyProblemReporter } from "../../lib/crypto/secret-box";
import { createKeyProblemReporter, keyProblemAlert } from "../../lib/crypto/unreadable-secret";
import { piiHash } from "../../lib/event-pii";

const ENV_VARS = [
  "SECRETS_KEY",
  "SECRETS_KEY_ID",
  "SECRETS_KEY_PREVIOUS",
  "SECRETS_KEY_PREVIOUS_ID",
  "EVENT_PII_HASH_KEY",
  "CONTACT_CODE_HASH_KEY",
];
for (const v of ENV_VARS) delete process.env[v];

// A recording reporter instead of the real admin alert (the import of
// derived-keys installed the default one).
let keyProblems: string[][] = [];
setKeyProblemReporter((p) => keyProblems.push(p));

const KA = Buffer.alloc(32, 0x11);
const KB = Buffer.alloc(32, 0x22);
const A = { SECRETS_KEY: KA.toString("base64"), SECRETS_KEY_ID: "ka" };
const B = { SECRETS_KEY: KB.toString("base64"), SECRETS_KEY_ID: "kb" };
const PURPOSES: KeyPurpose[] = ["event-pii-hash", "contact-code-hash"];

/** Run fn with exactly these env vars set (every other key var unset), then restore. */
function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  for (const v of ENV_VARS) delete process.env[v];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const v of ENV_VARS) delete process.env[v];
  }
}

/** RFC 5869 HKDF-SHA256, written out with HMAC: an independent check of hkdfSync's use. */
function rfc5869(ikm: Buffer, salt: Buffer, info: string, len: number): Buffer {
  const prk = createHmac("sha256", salt.length ? salt : Buffer.alloc(32)).update(ikm).digest();
  let t = Buffer.alloc(0);
  const out: Buffer[] = [];
  for (let i = 1; Buffer.concat(out).length < len; i++) {
    t = createHmac("sha256", prk).update(Buffer.concat([t, Buffer.from(info, "utf8"), Buffer.from([i])])).digest();
    out.push(t);
  }
  return Buffer.concat(out).subarray(0, len);
}

// Frozen copies of today's (pre-HKDF) functions.
function legacyPiiHash(value: string): string {
  const v = value.trim();
  const norm = v.includes("@") ? v.toLowerCase() : `+${v.replace(/\D/g, "")}`;
  return createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 12);
}
const TENANT = "00000000-0000-4000-8000-0000000000a1";
const KIND: ContactKind = "owner_recap_email";
const ADDRESS = "recap@example.com";
function n2HashCode(i: { userId: string; kind: string; value: string; salt: string; code: string }): string {
  const material = ["contact-code:v1", i.userId, i.kind, i.value.trim().toLowerCase(), i.salt, i.code].join("\u0000");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
const CODE_INPUT = { userId: TENANT, kind: KIND, value: ADDRESS, salt: "5a17", code: "424242" };
const PHONES = ["+15550100123", "+1 555-010-0123", "ana@example.com"];

// Each label gives a distinct key; both differ from SECRETS_KEY itself.
{
  const ev = derivedKey("event-pii-hash", A)!;
  const cc = derivedKey("contact-code-hash", A)!;
  assert.ok(ev && cc);
  assert.equal(ev.length, 32);
  assert.equal(cc.length, 32);
  assert.ok(!ev.equals(cc), "the two purposes never share key material");
  assert.ok(!ev.equals(KA) && !cc.equals(KA), "a derived key is not SECRETS_KEY");
  // HKDF-SHA256, empty salt, info = the label verbatim.
  for (const p of PURPOSES) assert.ok(derivedKey(p, A)!.equals(rfc5869(KA, Buffer.alloc(0), p, 32)), `${p}: RFC 5869 HKDF`);
}

// Deterministic for the same SECRETS_KEY; changes when SECRETS_KEY changes;
// SECRETS_KEY_PREVIOUS is never used.
for (const p of PURPOSES) {
  assert.ok(derivedKey(p, A)!.equals(derivedKey(p, { ...A })!), `${p}: deterministic`);
  assert.ok(!derivedKey(p, A)!.equals(derivedKey(p, B)!), `${p}: changes with SECRETS_KEY`);
  const rotating = { ...B, SECRETS_KEY_PREVIOUS: A.SECRETS_KEY, SECRETS_KEY_PREVIOUS_ID: "ka" };
  assert.ok(derivedKey(p, rotating)!.equals(derivedKey(p, B)!), `${p}: only the current key, never PREVIOUS`);
  assert.equal(derivedKey(p, { SECRETS_KEY_PREVIOUS: A.SECRETS_KEY, SECRETS_KEY_PREVIOUS_ID: "ka" }), null, `${p}: PREVIOUS alone derives nothing`);
  assert.equal(derivedKey(p, {}), null, `${p}: nothing set → null`);
}

// An override wins over the derived key, for its purpose only; blank = unset.
{
  assert.deepEqual(OVERRIDE_ENV, { "event-pii-hash": "EVENT_PII_HASH_KEY", "contact-code-hash": "CONTACT_CODE_HASH_KEY" });
  const evOverride = { ...A, EVENT_PII_HASH_KEY: "mock-event-override-0001" };
  assert.ok(derivedKey("event-pii-hash", evOverride)!.equals(Buffer.from("mock-event-override-0001", "utf8")));
  assert.ok(derivedKey("contact-code-hash", evOverride)!.equals(derivedKey("contact-code-hash", A)!), "the event override leaves the code pepper");
  const ccOverride = { ...A, CONTACT_CODE_HASH_KEY: "mock-code-override-0001" };
  assert.ok(derivedKey("contact-code-hash", ccOverride)!.equals(Buffer.from("mock-code-override-0001", "utf8")));
  assert.ok(derivedKey("event-pii-hash", ccOverride)!.equals(derivedKey("event-pii-hash", A)!), "the code override leaves the event key");
  // An override works without SECRETS_KEY too.
  assert.ok(derivedKey("contact-code-hash", { CONTACT_CODE_HASH_KEY: "mock-code-override-0001" })!.equals(Buffer.from("mock-code-override-0001")));
  for (const blank of ["", "   "]) {
    assert.ok(derivedKey("event-pii-hash", { ...A, EVENT_PII_HASH_KEY: blank })!.equals(derivedKey("event-pii-hash", A)!), "blank override = unset");
    assert.equal(derivedKey("contact-code-hash", { CONTACT_CODE_HASH_KEY: blank }), null, "blank override, no master = null");
  }
  // Through the real hash functions (process.env, read at call time).
  withEnv(evOverride, () => {
    const k = Buffer.from("mock-event-override-0001", "utf8");
    assert.equal(piiHash("+15550100123"), createHmac("sha256", k).update("+15550100123").digest("hex").slice(0, 12));
  });
  withEnv(ccOverride, () => {
    const material = ["contact-code:v1", TENANT, KIND, ADDRESS, "5a17", "424242"].join("\u0000");
    assert.equal(hashCode(CODE_INPUT), createHmac("sha256", "mock-code-override-0001").update(material).digest("hex"));
  });
}

// All unset → byte-identical to today: plain sha256/12 and N2's salted sha256.
withEnv({}, () => {
  for (const x of [...PHONES, "", "abc"]) assert.equal(piiHash(x), legacyPiiHash(x), `no key: piiHash(${x})`);
  assert.equal(piiHash("+15550100123"), "71e19f521d9d", "no key: pinned plain sha256/12");
  assert.equal(hashCode(CODE_INPUT), n2HashCode(CODE_INPUT), "no key: N2's salted sha256");
  assert.equal(hashCode({ ...CODE_INPUT, value: " RECAP@Example.com " }), n2HashCode(CODE_INPUT), "no key: normalised value");
});
// SECRETS_KEY set → keyed, and different from the unkeyed hashes.
withEnv(A, () => {
  const ev = derivedKey("event-pii-hash")!;
  assert.equal(piiHash("+15550100123"), createHmac("sha256", ev).update("+15550100123").digest("hex").slice(0, 12));
  for (const x of PHONES) assert.notEqual(piiHash(x), legacyPiiHash(x));
  assert.notEqual(hashCode(CODE_INPUT), n2HashCode(CODE_INPUT));
});

// A malformed SECRETS_KEY → as E1: treated as not set (no-key fallback, no
// throw in the hash path) and reported to E1's ONE misconfiguration reporter,
// by env var name only.
{
  const malformed: Record<string, string>[] = [
    { SECRETS_KEY: "not-base64-of-32-bytes!", SECRETS_KEY_ID: "ka" },
    { SECRETS_KEY: Buffer.alloc(16, 0x44).toString("base64"), SECRETS_KEY_ID: "ka" },
    { SECRETS_KEY: A.SECRETS_KEY }, // id missing
    { SECRETS_KEY: A.SECRETS_KEY, SECRETS_KEY_ID: "bad id!" },
  ];
  for (const env of malformed) {
    keyProblems = [];
    for (const p of PURPOSES) assert.equal(derivedKey(p, env), null, "malformed → no key");
    assert.ok(keyProblems.length >= 1, "malformed → E1's reporter is told");
    for (const probs of keyProblems) {
      for (const pr of probs) assert.ok(!pr.includes(env.SECRETS_KEY), "a problem never carries the key");
    }
    keyProblems = [];
    withEnv(env, () => {
      assert.equal(piiHash("+15550100123"), legacyPiiHash("+15550100123"), "malformed → plain sha256/12");
      assert.equal(hashCode(CODE_INPUT), n2HashCode(CODE_INPUT), "malformed → N2's hash");
    });
    assert.ok(keyProblems.length >= 1, "the hash paths report too");
    // The alert E1 would send names the variables, never a value.
    const alert = keyProblemAlert(keyProblems[0]);
    assert.ok(!JSON.stringify(alert).includes(env.SECRETS_KEY));
  }
  // A throwing reporter never breaks a hash.
  setKeyProblemReporter(() => {
    throw new Error("reporter down");
  });
  withEnv(malformed[0], () => assert.equal(piiHash("+15550100123"), legacyPiiHash("+15550100123")));
  setKeyProblemReporter((p) => keyProblems.push(p));
  // The default reporter's log line carries names only.
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(" "));
  try {
    createKeyProblemReporter(async () => {})(["SECRETS_KEY must be base64 of exactly 32 bytes"]);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.ok(!warned[0].includes(malformed[0].SECRETS_KEY));
}

// Codes: issued without a key → fails once a key is set (documented: codes in
// flight are invalidated, 10 min TTL); issued and verified under the same key
// → confirmed; a SECRETS_KEY rotation invalidates a code in flight the same way.
{
  const row = (): StoredCode => ({ valueHash: valueKey(KIND, ADDRESS), salt: CODE_INPUT.salt, codeHash: hashCode(CODE_INPUT), attempts: 0, expired: false });
  const input = { userId: TENANT, kind: KIND, currentValue: ADDRESS, code: CODE_INPUT.code };
  const unkeyed = withEnv({}, row);
  withEnv(A, () => {
    assert.deepEqual(decideConfirm(unkeyed, input), { outcome: "refused", error: "invalid_code", write: { attempts: 1 } }, "no-key code, key set");
    const keyed = row();
    assert.deepEqual(decideConfirm(keyed, input), { outcome: "confirmed" }, "same key");
    withEnv(B, () => assert.equal(decideConfirm(keyed, input).outcome, "refused", "rotation invalidates a code in flight"));
  });
  withEnv({}, () => assert.deepEqual(decideConfirm(unkeyed, input), { outcome: "confirmed" }, "no key both ways"));
}

// No key material ever leaves through a return value meant for output: the
// hashes are hex digests that contain no key encoding.
{
  const material = [KA, derivedKey("event-pii-hash", A)!, derivedKey("contact-code-hash", A)!].flatMap((k) => [k.toString("hex"), k.toString("base64"), k.toString("base64url")]);
  const outputs = withEnv(A, () => [...PHONES.map(piiHash), hashCode(CODE_INPUT)]).join(" ");
  for (const m of material) assert.ok(!outputs.includes(m));
}

console.log("derived-keys: all passed");
