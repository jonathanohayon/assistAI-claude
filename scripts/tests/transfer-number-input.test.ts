// Transfer-number field helpers (lib/transfer-number-input.ts).
// Run with:  npx tsx scripts/tests/transfer-number-input.test.ts

import assert from "node:assert/strict";

import { splitTransferE164, toTransferE164 } from "../../lib/transfer-number-input";

const val = (r: ReturnType<typeof toTransferE164>) => (r.ok ? r.value : `ERR`);

// Israeli mobile typed locally: trunk 0 dropped, +972 added.
assert.equal(val(toTransferE164("+972", "050-123-4567")), "+972501234567");
assert.equal(val(toTransferE164("+972", "501234567")), "+972501234567");
// French local number.
assert.equal(val(toTransferE164("+33", "06 12 34 56 78")), "+33612345678");
// US: no trunk 0 to drop.
assert.equal(val(toTransferE164("+1", "(555) 000-0000")), "+15550000000");
// An explicit international number ignores the selected prefix.
assert.equal(val(toTransferE164("+972", "+33 6 12 34 56 78")), "+33612345678");
assert.equal(val(toTransferE164("+1", "00972501234567")), "+972501234567");
// Empty clears.
assert.equal(val(toTransferE164("+972", "  ")), "");
// Invalid input is refused, not guessed.
assert.equal(val(toTransferE164("+972", "05a1234567")), "ERR");
assert.equal(val(toTransferE164("+972", "123")), "ERR");

// Round trip for display.
assert.deepEqual(splitTransferE164("+972501234567"), { prefix: "+972", local: "0501234567" });
assert.deepEqual(splitTransferE164("+15550000000"), { prefix: "+1", local: "5550000000" });
assert.deepEqual(splitTransferE164(""), { prefix: "+972", local: "" });
assert.deepEqual(splitTransferE164("+4915112345678"), { prefix: "+972", local: "+4915112345678" });
for (const v of ["+972501234567", "+33612345678", "+15550000000"]) {
  const s = splitTransferE164(v);
  assert.equal(val(toTransferE164(s.prefix, s.local)), v);
}

console.log("ALL TRANSFER-NUMBER-INPUT TESTS PASSED");
