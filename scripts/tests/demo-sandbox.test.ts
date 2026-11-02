// Unit tests for lib/demo-sandbox.ts.
// Run with:  npx tsx scripts/tests/demo-sandbox.test.ts

import assert from "node:assert/strict";

import { demoPolicy } from "../../lib/demo-sandbox";

// THE BUG: anonymous callers can no longer read or delete calendar events
assert.equal(demoPolicy("find"), "deny");
assert.equal(demoPolicy("cancel"), "deny");
assert.equal(demoPolicy("reschedule"), "deny");

// the landing demo keeps working, but writes nothing
assert.equal(demoPolicy("book"), "simulate");
assert.equal(demoPolicy("sheets-contact"), "simulate");

// free slots carry no personal data
assert.equal(demoPolicy("availability"), "allow");
assert.equal(demoPolicy("list-dates"), "allow");

console.log("ALL DEMO-SANDBOX TESTS PASSED");
