// Unit tests for isTrialExhausted and trialExhaustionCause (lib/trial.ts).
// Run with:  npx tsx scripts/tests/trial.test.ts

import assert from "node:assert/strict";

import { isTrialExhausted, trialExhaustionCause, TRIAL_PAUSED_STATUS, TRIAL_SECONDS_LIMIT } from "../../lib/trial";

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

// trialExhaustionCause names which condition refused
const t = { subscriptionStatus: "trialing", trialEndsAt: future, trialSecondsUsed: 0, role: "user", now };
assert.equal(trialExhaustionCause({ ...t, trialEndsAt: past }), "time", "(a) end date passed → time");
assert.equal(trialExhaustionCause({ ...t, trialSecondsUsed: TRIAL_SECONDS_LIMIT }), "minutes", "(b) minutes used up → minutes");
assert.equal(trialExhaustionCause({ ...t, subscriptionStatus: TRIAL_PAUSED_STATUS }), "paused", "(c) paused → paused");
assert.equal(trialExhaustionCause({ ...t, trialEndsAt: past, trialSecondsUsed: TRIAL_SECONDS_LIMIT }), "time", "(a)+(b) → time wins");
assert.equal(trialExhaustionCause({ ...t, trialEndsAt: now }), "time", "end date exactly now → time");
assert.equal(trialExhaustionCause({ ...t, trialSecondsUsed: TRIAL_SECONDS_LIMIT - 1 }), null, "within limits → null");
assert.equal(trialExhaustionCause({ ...t, role: "admin", trialEndsAt: past, trialSecondsUsed: TRIAL_SECONDS_LIMIT }), null, "admin exempt");
assert.equal(trialExhaustionCause({ ...t, role: "admin", subscriptionStatus: TRIAL_PAUSED_STATUS }), null, "paused admin exempt");
assert.equal(trialExhaustionCause({ ...t, subscriptionStatus: "active", trialSecondsUsed: 10 * TRIAL_SECONDS_LIMIT }), null, "paid over the trial minutes → null (overage)");
assert.equal(trialExhaustionCause({ ...t, subscriptionStatus: "active", trialEndsAt: past }), null, "paid with a past trial end date → null");

console.log("ALL TRIAL TESTS PASSED");
