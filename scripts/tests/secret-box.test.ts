// Unit tests for lib/crypto/secret-box.ts and lib/crypto/unreadable-secret.ts (E1).
// Run with:  npx tsx scripts/tests/secret-box.test.ts
// Keys are generated here, per run: no real key is ever used or committed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  isSealed,
  keyringFromEnv,
  openSecret,
  sealForStorage,
  sealSecret,
} from "../../lib/crypto/secret-box";
import {
  createUnreadableReporter,
  openStoredSecret,
  type UnreadableAlert,
} from "../../lib/crypto/unreadable-secret";

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

alertTests().then(
  () => console.log("ALL SECRET-BOX TESTS PASSED"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
