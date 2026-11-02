// Unit tests for isTrialExhausted (lib/trial.ts).
// Run with:  npx tsx scripts/tests/trial.test.ts

import assert from "node:assert/strict";

import { isTrialExhausted, TRIAL_SECONDS_LIMIT } from "../../lib/trial";

const now = new Date("2026-11-01T12:00:00Z");
const past = new Date("2026-10-31T12:00:00Z");
const future = new Date("2026-11-02T12:00:00Z");

// a trial account is cut at 60 min of calls
assert.equal(
  isTrialExhausted({ subscriptionStatus: "trialing", trialEndsAt: future, trialSecondsUsed: TRIAL_SECONDS_LIMIT, now }),
  true,
);

// a trial account is cut when the 24 h are over
assert.equal(
  isTrialExhausted({ subscriptionStatus: "trialing", trialEndsAt: past, trialSecondsUsed: 0, now }),
  true,
);

// THE TRAP: the prod admin is `trialing` with no end date; real durations must not cut it
assert.equal(
  isTrialExhausted({ subscriptionStatus: "trialing", trialEndsAt: null, trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT, role: "admin", now }),
  false,
);

// a paying account is never concerned
assert.equal(
  isTrialExhausted({ subscriptionStatus: "active", trialEndsAt: past, trialSecondsUsed: 99_999, now }),
  false,
);

// within limits stays open
assert.equal(
  isTrialExhausted({ subscriptionStatus: "trialing", trialEndsAt: future, trialSecondsUsed: 60, role: "user", now }),
  false,
);

console.log("ALL TRIAL TESTS PASSED");
