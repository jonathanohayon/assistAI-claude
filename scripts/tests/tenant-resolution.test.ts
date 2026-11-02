// Unit tests for lib/tenant-resolution.ts.
// Run with:  npx tsx scripts/tests/tenant-resolution.test.ts

import assert from "node:assert/strict";

import { decideTenantResolution } from "../../lib/tenant-resolution";

// THE BUG: an unknown dialed number is refused, never served the default tenant
assert.equal(
  decideTenantResolution({ phone: "+97233820485", userId: null, matched: false }),
  "unknown_number",
);

// a known dialed number routes to its tenant
assert.equal(
  decideTenantResolution({ phone: "+97223764700", userId: null, matched: true }),
  "phone_match",
);

// web LiveTest (userId) keeps its behaviour, matched or not
assert.equal(decideTenantResolution({ phone: null, userId: "u1", matched: true }), "user_match");
assert.equal(decideTenantResolution({ phone: null, userId: "u1", matched: false }), "default_fallback");

// userId wins over phone, as before
assert.equal(decideTenantResolution({ phone: "+972", userId: "u1", matched: true }), "user_match");

// no identifier at all keeps the default path
assert.equal(decideTenantResolution({ phone: null, userId: null, matched: false }), "no_id");

console.log("ALL TENANT-RESOLUTION TESTS PASSED");
