// Call-forwarding setup check (lib/forwarding-test.ts). Mock numbers only.
// Run with:  npx tsx scripts/tests/forwarding-test.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CANCEL_TEST_PATCH,
  FORWARDING_TEST_WINDOW_MS,
  forwardingStatus,
  parsePhone,
  verificationMethod,
} from "../../lib/forwarding-test";

const sql = readFileSync(new URL("../../drizzle/0037_forwarding_test.sql", import.meta.url), "utf8");
assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 5);

const t0 = new Date("2026-11-05T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const base = { forwardingTestStartedAt: t0, forwardingDetectedAt: null as Date | null };

assert.equal(forwardingStatus({ ...base, forwardingTestStartedAt: null }, t0), "idle");
assert.equal(forwardingStatus(base, at(60_000)), "waiting");
assert.equal(forwardingStatus(base, at(FORWARDING_TEST_WINDOW_MS + 1)), "expired");
assert.equal(
  forwardingStatus({ ...base, forwardingDetectedAt: at(30_000) }, at(FORWARDING_TEST_WINDOW_MS + 1)),
  "detected",
);
// a detection from an older test does not count for a restarted window
assert.equal(forwardingStatus({ ...base, forwardingDetectedAt: at(-60_000) }, at(1_000)), "waiting");

// method: no forward header → 'window'; header matching the business number → 'diversion'
assert.equal(verificationMethod(null, "+97220000000"), "window");
assert.equal(verificationMethod("", ""), "window");
assert.equal(verificationMethod("+97220000000", "+97220000000"), "diversion");
assert.equal(verificationMethod("sip:+97220000000@pstn.example.test", "+97220000000"), "diversion");
assert.equal(verificationMethod("020000000", "+97220000000"), "diversion");
assert.equal(verificationMethod("+97230000000", "+97220000000"), "window"); // forwarded from elsewhere
assert.equal(verificationMethod("+97220000000", ""), "diversion"); // no business number given

// wizard input
assert.equal(parsePhone("02-000-0000"), "+97220000000");
assert.equal(parsePhone("+97220000000"), "+97220000000");
assert.equal(parsePhone("abc"), null);
assert.equal(parsePhone(42), null);

console.log("ALL FORWARDING-TEST TESTS PASSED");

// Cancel: clears the window only — never a past verification or detection.
assert.deepEqual(Object.keys(CANCEL_TEST_PATCH), ["forwardingTestStartedAt"]);
assert.equal(CANCEL_TEST_PATCH.forwardingTestStartedAt, null);
// After a cancel the status is idle, whatever was detected before.
assert.equal(forwardingStatus({ ...base, ...CANCEL_TEST_PATCH }, at(60_000)), "idle");
assert.equal(forwardingStatus({ forwardingDetectedAt: at(30_000), ...CANCEL_TEST_PATCH }, at(60_000)), "idle");
// The call-side matcher needs an OPEN window (startedAt within it) in both its read and its update,
// so a cleared window can never match.
{
  const src = readFileSync(new URL("../../lib/forwarding-test-db.ts", import.meta.url), "utf8");
  assert.equal(src.match(/gte\(agentConfigs\.forwardingTestStartedAt, windowStart\)/g)?.length, 2);
  const route = readFileSync(new URL("../../app/api/dashboard/forwarding-test/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function DELETE[\s\S]*\.set\(CANCEL_TEST_PATCH\)/);
}
console.log("FORWARDING CANCEL OK");

