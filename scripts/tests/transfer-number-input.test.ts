// Transfer-number field helpers (lib/transfer-number-input.ts).
// Run with:  npx tsx scripts/tests/transfer-number-input.test.ts

import assert from "node:assert/strict";

import { splitTransferE164, toTransferE164 } from "../../lib/transfer-number-input";

const val = (r: ReturnType<typeof toTransferE164>) => (r.ok ? r.value : `ERR`);

// Israeli mobile typed locally: trunk 0 dropped, +972 added.
assert.equal(val(toTransferE164("+972", "050-000-0000")), "+972500000000");
assert.equal(val(toTransferE164("+972", "500000000")), "+972500000000");
// French local number.
assert.equal(val(toTransferE164("+33", "06 00 00 00 00")), "+33600000000");
// US: no trunk 0 to drop.
assert.equal(val(toTransferE164("+1", "(555) 000-0000")), "+15550000000");
// An explicit international number ignores the selected prefix.
assert.equal(val(toTransferE164("+972", "+33 6 00 00 00 00")), "+33600000000");
assert.equal(val(toTransferE164("+1", "00972500000000")), "+972500000000");
// Empty clears.
assert.equal(val(toTransferE164("+972", "  ")), "");
// Invalid input is refused, not guessed.
assert.equal(val(toTransferE164("+972", "05a1234567")), "ERR");
assert.equal(val(toTransferE164("+972", "123")), "ERR");

// Round trip for display.
assert.deepEqual(splitTransferE164("+972500000000"), { prefix: "+972", local: "0500000000" });
assert.deepEqual(splitTransferE164("+15550000000"), { prefix: "+1", local: "5550000000" });
assert.deepEqual(splitTransferE164(""), { prefix: "+972", local: "" });
assert.deepEqual(splitTransferE164("+4915100000000"), { prefix: "+972", local: "+4915100000000" });
for (const v of ["+972500000000", "+33600000000", "+15550000000"]) {
  const s = splitTransferE164(v);
  assert.equal(val(toTransferE164(s.prefix, s.local)), v);
}

console.log("ALL TRANSFER-NUMBER-INPUT TESTS PASSED");
