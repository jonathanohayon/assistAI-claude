// Contacts × loyalty join (lib/contacts/loyalty-join.ts).
// Run with:  npx tsx scripts/tests/loyalty-join.test.ts

import assert from "node:assert/strict";

import { sheetPhoneToE164, visitsByPhone, visitsFor, type ClientVisits } from "../../lib/contacts/loyalty-join";

assert.equal(sheetPhoneToE164("050-000-0000"), "+972500000000");
assert.equal(sheetPhoneToE164("050 000 0000"), "+972500000000");
assert.equal(sheetPhoneToE164("02-500-0000"), "+97225000000"); // landline
assert.equal(sheetPhoneToE164("+972 50 000 0000"), "+972500000000");
assert.equal(sheetPhoneToE164("00972500000000"), "+972500000000");
assert.equal(sheetPhoneToE164("972500000000"), "+972500000000");
assert.equal(sheetPhoneToE164("+15550000000"), "+15550000000");
for (const bad of ["", "abc", "500000000", "0", "+0123"]) assert.equal(sheetPhoneToE164(bad), "", bad);

const v = (phone: string, visits: number): ClientVisits => ({
  phone, name: "", visits, lastVisitAt: null, nextVisitAt: null, regular: visits >= 3,
});
const idx = visitsByPhone([v("+972500000000", 4), v("+972500000001", 1)]);
assert.equal(visitsFor(idx, "050-000-0000")?.visits, 4);
assert.equal(visitsFor(idx, "0500000001")?.regular, false);
assert.equal(visitsFor(idx, "0500000002"), null);
assert.equal(visitsFor(idx, ""), null);

console.log("ALL LOYALTY-JOIN TESTS PASSED");
