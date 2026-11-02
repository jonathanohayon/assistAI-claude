// Unit tests for lib/trunk-reconcile.ts (fictional numbers only).
// Run with:  npx tsx scripts/tests/trunk-reconcile.test.ts

import assert from "node:assert/strict";

import { planTrunk } from "../../lib/trunk-reconcile";

// numbers released on Twilio are removed, numbers we own but miss are added
{
  const p = planTrunk({
    current: ["+15555550101", "+15555550102", "+15555550103"],
    desired: ["+15555550101", "+15555550104"],
    currentAllowed: [],
    desiredAllowed: null,
  });
  assert.deepEqual(p.remove, ["+15555550102", "+15555550103"]);
  assert.deepEqual(p.add, ["+15555550104"]);
  assert.equal(p.setAllowedAddresses, null);
  assert.equal(p.noop, false);
}

// idempotent: a second run on the reconciled trunk does nothing
{
  const p = planTrunk({
    current: ["+15555550101", "+15555550104"],
    desired: ["+15555550104", "+15555550101"],
    currentAllowed: ["198.51.100.0/24"],
    desiredAllowed: ["198.51.100.0/24"],
  });
  assert.equal(p.noop, true);
}

// allowed addresses are only set when they differ (order-insensitive)
{
  const p = planTrunk({
    current: [],
    desired: [],
    currentAllowed: [],
    desiredAllowed: ["203.0.113.0/24", "198.51.100.0/24"],
  });
  assert.deepEqual(p.setAllowedAddresses, ["198.51.100.0/24", "203.0.113.0/24"]);
}

console.log("ALL TRUNK-RECONCILE TESTS PASSED");
