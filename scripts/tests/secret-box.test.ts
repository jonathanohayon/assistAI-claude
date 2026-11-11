// Unit tests for lib/crypto/secret-box.ts and lib/crypto/unreadable-secret.ts (E1).
// Run with:  npx tsx scripts/tests/secret-box.test.ts
// Keys are generated here, per run: no real key is ever used or committed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  isSealed,
  keyringFromEnv,
  openSecret,
  SEALED_SECRET_REFUSED_MESSAGE,
  sealedSecretRefusal,
  sealForStorage,
  sealSecret,
  setKeyProblemReporter,
} from "../../lib/crypto/secret-box";
import {
  createKeyProblemReporter,
  createUnreadableReporter,
  type KeyProblemAlert,
  openStoredSecret,
  type UnreadableAlert,
} from "../../lib/crypto/unreadable-secret";

// No real admin alert from a unit test: a recording reporter (the import
// above installed the default one).
let keyProblems: string[][] = [];
setKeyProblemReporter((p) => keyProblems.push(p));

const newKey = () => randomBytes(32).toString("base64");
const A = { SECRETS_KEY: newKey(), SECRETS_KEY_ID: "ka" };
const B = { SECRETS_KEY: newKey(), SECRETS_KEY_ID: "kb" };
const NONE = {};
const PLAIN = "mock-secret-value-0123456789";

// round trip
{
  const sealed = sealSecret(PLAIN, A);
  assert.ok(isSealed(sealed));
  assert.match(
    sealed,
    /^enc:v1:ka:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
  );
  assert.deepEqual(openSecret(sealed, A), { ok: true, value: PLAIN });
  // unicode and empty strings survive too
  assert.deepEqual(openSecret(sealSecret("שלום é", A), A), {
    ok: true,
    value: "שלום é",
  });
  assert.deepEqual(openSecret(sealSecret("", A), A), { ok: true, value: "" });
}

// sealed output never contains the plain value (nor its base64)
{
  const sealed = sealSecret(PLAIN, A);
  assert.ok(!sealed.includes(PLAIN));
  assert.ok(!sealed.includes(Buffer.from(PLAIN).toString("base64url")));
  assert.ok(
    !sealed.includes(Buffer.from(PLAIN).toString("base64").slice(0, 12)),
  );
}

// a random IV per value: sealing twice gives two different values
assert.notEqual(sealSecret(PLAIN, A), sealSecret(PLAIN, A));

// tamper: flipping one byte of the IV, the tag or the ciphertext fails closed
{
  const sealed = sealSecret(PLAIN, A);
  const parts = sealed.split(":");
  for (const idx of [3, 4, 5]) {
    const buf = Buffer.from(parts[idx], "base64url");
    buf[0] ^= 0x01;
    const tampered = [
      ...parts.slice(0, idx),
      buf.toString("base64url"),
      ...parts.slice(idx + 1),
    ].join(":");
    const r = openSecret(tampered, A);
    assert.equal(r.ok, false, `tamper part ${idx}`);
    assert.ok(!("value" in r));
  }
  // the kid is bound to the value: relabelling it under another known key fails
  const both = {
    ...A,
    SECRETS_KEY_PREVIOUS: B.SECRETS_KEY,
    SECRETS_KEY_PREVIOUS_ID: "kb",
  };
  const relabelled = ["enc", "v1", "kb", ...parts.slice(3)].join(":");
  assert.deepEqual(openSecret(relabelled, both), {
    ok: false,
    reason: "auth_failed",
  });
  // truncated / malformed values fail closed
  assert.equal(openSecret(parts.slice(0, 5).join(":"), A).ok, false);
  assert.equal(openSecret("enc:v1:ka:!!:!!:!!", A).ok, false);
  assert.deepEqual(openSecret("enc:v9:ka:x:y:z", A), {
    ok: false,
    reason: "unsupported_version",
  });
}

// wrong key under the same id → auth_failed (fail closed)
assert.deepEqual(
  openSecret(sealSecret(PLAIN, A), {
    SECRETS_KEY: newKey(),
    SECRETS_KEY_ID: "ka",
  }),
  { ok: false, reason: "auth_failed" },
);

// unknown kid → fail closed
assert.deepEqual(openSecret(sealSecret(PLAIN, A), B), {
  ok: false,
  reason: "unknown_kid",
});

// rotation: sealed with A, still readable after rotating to B with A as previous
{
  const sealedA = sealSecret(PLAIN, A);
  const rotated = {
    ...B,
    SECRETS_KEY_PREVIOUS: A.SECRETS_KEY,
    SECRETS_KEY_PREVIOUS_ID: "ka",
  };
  assert.deepEqual(openSecret(sealedA, rotated), { ok: true, value: PLAIN });
  // new writes use the NEW key, never the previous one
  assert.match(sealForStorage(PLAIN, rotated), /^enc:v1:kb:/);
  // the previous key alone reads but never seals
  const prevOnly = {
    SECRETS_KEY_PREVIOUS: A.SECRETS_KEY,
    SECRETS_KEY_PREVIOUS_ID: "ka",
  };
  assert.deepEqual(openSecret(sealedA, prevOnly), { ok: true, value: PLAIN });
  assert.equal(sealForStorage(PLAIN, prevOnly), PLAIN);
}

// plain passthrough (with or without a key)
assert.deepEqual(openSecret(PLAIN, A), { ok: true, value: PLAIN });
assert.deepEqual(openSecret(PLAIN, NONE), { ok: true, value: PLAIN });
assert.equal(isSealed(PLAIN), false);

// no key + sealed value → fail closed
assert.deepEqual(openSecret(sealSecret(PLAIN, A), NONE), {
  ok: false,
  reason: "no_key",
});

// no key + plain write → plain (E1 without the key = today)
assert.equal(sealForStorage(PLAIN, NONE), PLAIN);
assert.throws(() => sealSecret(PLAIN, NONE));
// key set → the write is sealed
assert.ok(isSealed(sealForStorage(PLAIN, A)));

// a malformed key counts as not set (writes stay plain), problems name the var only
{
  const bad = {
    SECRETS_KEY: Buffer.from("short").toString("base64"),
    SECRETS_KEY_ID: "ka",
  };
  assert.equal(sealForStorage(PLAIN, bad), PLAIN);
  const ring = keyringFromEnv(bad);
  assert.equal(ring.current, null);
  assert.ok(ring.problems.some((p) => p.startsWith("SECRETS_KEY ")));
  assert.ok(!ring.problems.join(" ").includes(bad.SECRETS_KEY));
  assert.equal(keyringFromEnv({ SECRETS_KEY: newKey() }).current, null); // id required
  assert.equal(
    keyringFromEnv({ SECRETS_KEY: newKey(), SECRETS_KEY_ID: "bad id!" })
      .current,
    null,
  );
  // base64url keys are accepted
  assert.ok(
    keyringFromEnv({
      SECRETS_KEY: randomBytes(32).toString("base64url"),
      SECRETS_KEY_ID: "u",
    }).current,
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// a misconfigured key is LOUD: problems reach the reporter on a seal / open
// attempt (names only), the write stays plain; a valid key reports nothing
{
  keyProblems = [];
  const badKey = Buffer.from("short").toString("base64");
  assert.equal(
    sealForStorage(PLAIN, { SECRETS_KEY: badKey, SECRETS_KEY_ID: "ka" }),
    PLAIN,
  );
  assert.equal(keyProblems.length, 1);
  assert.deepEqual(keyProblems[0], [
    "SECRETS_KEY must be base64 of exactly 32 bytes",
  ]);
  // an id without a key, a previous key without an id
  keyProblems = [];
  assert.equal(
    sealForStorage(PLAIN, {
      SECRETS_KEY_ID: "ka",
      SECRETS_KEY_PREVIOUS: newKey(),
    }),
    PLAIN,
  );
  assert.deepEqual(keyProblems[0], [
    "SECRETS_KEY is missing (SECRETS_KEY_ID is set)",
    "SECRETS_KEY_PREVIOUS_ID is missing (SECRETS_KEY_PREVIOUS is set)",
  ]);
  // an open attempt reports too (plain passthrough unchanged, sealed fails closed)
  keyProblems = [];
  assert.deepEqual(
    openSecret(PLAIN, { SECRETS_KEY: badKey, SECRETS_KEY_ID: "ka" }),
    { ok: true, value: PLAIN },
  );
  assert.equal(keyProblems.length, 1);
  // valid keys and no keys report nothing
  keyProblems = [];
  sealForStorage(PLAIN, A);
  openSecret(sealSecret(PLAIN, A), {
    ...B,
    SECRETS_KEY_PREVIOUS: A.SECRETS_KEY,
    SECRETS_KEY_PREVIOUS_ID: "ka",
  });
  sealForStorage(PLAIN, NONE);
  openSecret(PLAIN, NONE);
  assert.equal(keyProblems.length, 0);
  // a reporter that throws never breaks a write
  setKeyProblemReporter(() => {
    throw new Error("boom");
  });
  assert.equal(
    sealForStorage(PLAIN, { SECRETS_KEY: badKey, SECRETS_KEY_ID: "ka" }),
    PLAIN,
  );
  setKeyProblemReporter((p) => keyProblems.push(p));
}

// the misconfigured-key ALERT: once (dedup), env var names only, never a value
async function keyProblemAlertTests() {
  const sent: KeyProblemAlert[] = [];
  let t = 0;
  const reporter = createKeyProblemReporter(
    async (a) => {
      sent.push(a);
    },
    () => t,
  );
  setKeyProblemReporter(reporter);
  const bad = { SECRETS_KEY: "not-a-valid-key-value", SECRETS_KEY_ID: "ka" };
  for (let i = 0; i < 20; i++) assert.equal(sealForStorage(PLAIN, bad), PLAIN);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "secrets_key_misconfigured");
  assert.ok(
    sent[0].body.includes("SECRETS_KEY must be base64 of exactly 32 bytes"),
  );
  assert.ok(!JSON.stringify(sent[0]).includes(bad.SECRETS_KEY));
  // re-alerts only after the window
  t += 7 * 60 * 60 * 1000;
  sealForStorage(PLAIN, bad);
  await flush();
  assert.equal(sent.length, 2);
  // a valid key: no alert
  const sentOk: KeyProblemAlert[] = [];
  setKeyProblemReporter(
    createKeyProblemReporter(async (a) => void sentOk.push(a)),
  );
  assert.ok(isSealed(sealForStorage(PLAIN, A)));
  await flush();
  assert.equal(sentOk.length, 0);
  setKeyProblemReporter((p) => keyProblems.push(p));
}

// a PROVIDED secret already in the sealed format is refused (tools + agent brain share it)
assert.deepEqual(sealedSecretRefusal(sealSecret(PLAIN, A), "secret"), {
  error: "invalid_secret",
  message: SEALED_SECRET_REFUSED_MESSAGE,
  fields: ["secret"],
});
assert.ok(sealedSecretRefusal("  enc:v1:x:y:z:w", "secret"));
assert.equal(sealedSecretRefusal(PLAIN, "secret"), null);
assert.equal(sealedSecretRefusal(undefined, "secret"), null);
assert.equal(sealedSecretRefusal(null, "secret"), null);

// the alert: sent ONCE per kind (dedup), plain text, no value, no ciphertext
async function alertTests() {
  const sent: UnreadableAlert[] = [];
  const report = createUnreadableReporter(async (a) => {
    sent.push(a);
  });
  const sealed = sealSecret(PLAIN, A);
  for (let i = 0; i < 50; i++)
    assert.equal(openStoredSecret("google", sealed, report, B), null);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "secret_unreadable:google");
  assert.ok(sent[0].body.includes("unknown_kid"));
  const text = JSON.stringify(sent[0]);
  assert.ok(!text.includes(PLAIN));
  for (const part of sealed.split(":").slice(3))
    assert.ok(!text.includes(part));
  assert.ok(!text.includes(A.SECRETS_KEY) && !text.includes(B.SECRETS_KEY));
  // another kind alerts on its own; the window expires after 6 h
  report("agent_brain", "no_key");
  await flush();
  assert.equal(sent.length, 2);
  report("google", "no_key", Date.now() + 7 * 60 * 60 * 1000);
  await flush();
  assert.equal(sent.length, 3);
  // a readable value or a plain one never alerts
  let quietCalls = 0;
  const quiet = createUnreadableReporter(async () => {
    quietCalls++;
  });
  assert.equal(openStoredSecret("google", sealed, quiet, A), PLAIN);
  assert.equal(openStoredSecret("google", PLAIN, quiet, NONE), PLAIN);
  assert.equal(openStoredSecret("google", null, quiet, NONE), null);
  await flush();
  assert.equal(quietCalls, 0);
  // a sender that throws or rejects never breaks the caller
  const throwing = createUnreadableReporter(() => {
    throw new Error("boom");
  });
  assert.equal(openStoredSecret("google", sealed, throwing, NONE), null);
  const rejecting = createUnreadableReporter(() =>
    Promise.reject(new Error("boom")),
  );
  assert.equal(openStoredSecret("google", sealed, rejecting, NONE), null);
  await flush();
  // sends are serialised: two kinds reported together reach the sender one after the other
  const order: string[] = [];
  let inFlight = 0;
  const serial = createUnreadableReporter(async (a) => {
    inFlight++;
    assert.equal(inFlight, 1);
    await flush();
    order.push(a.key);
    inFlight--;
  });
  serial("agent_brain", "no_key");
  serial("client_agent", "no_key");
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(order, [
    "secret_unreadable:agent_brain",
    "secret_unreadable:client_agent",
  ]);
}

alertTests()
  .then(keyProblemAlertTests)
  .then(
    () => console.log("ALL SECRET-BOX TESTS PASSED"),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
