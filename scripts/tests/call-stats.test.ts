// Unit tests for the pure helpers in lib/call-stats.ts.
// Run with:  npx tsx scripts/tests/call-stats.test.ts

import assert from "node:assert/strict";

import { bookingRate, formatAvgDuration } from "../../lib/call-stats";

// average duration formatting
assert.equal(formatAvgDuration(0), "—");
assert.equal(formatAvgDuration(245), "4m05");
assert.equal(formatAvgDuration(59.6), "1m00");
assert.equal(formatAvgDuration(Number.NaN), "—");

// conversion is bookings over calls, not "has a summary"
assert.equal(bookingRate(3, 12), 25);
assert.equal(bookingRate(0, 0), 0);
// a call can trigger a reschedule-as-booking: never above 100
assert.equal(bookingRate(15, 10), 100);

console.log("ALL CALL-STATS TESTS PASSED");
