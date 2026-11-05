// Call-transfer number validation (lib/transfer-number.ts).
// Run with:  npx tsx scripts/tests/transfer-number.test.ts

import assert from "node:assert/strict";

import { parseTransferNumber } from "../../lib/transfer-number";

const ok = (raw: unknown) => {
  const r = parseTransferNumber(raw);
  assert.ok(r.ok, `${String(raw)} should be valid`);
  return r.ok ? r.value : "";
};
assert.equal(ok("+15550000000"), "+15550000000");
assert.equal(ok("+1 (555) 000-0000"), "+15550000000");
assert.equal(ok("00 1 555 000 0000"), "+15550000000"); // 00 international prefix
assert.equal(ok(""), "");
assert.equal(ok("   "), "");
assert.equal(ok(null), "");

for (const bad of ["0550000000", "15550000000", "+0123456789", "+1234567", "+1234567890123456", "abc", "+1 555 000 000a", 15550000000]) {
  assert.equal(parseTransferNumber(bad).ok, false, `${String(bad)} must be refused`);
}

console.log("ALL TRANSFER-NUMBER TESTS PASSED");
