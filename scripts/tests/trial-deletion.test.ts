// Unit tests for isTrialDeletionDue (lib/trial.ts).
// Run with:  npx tsx scripts/tests/trial-deletion.test.ts

import assert from "node:assert/strict";

import { isTrialDeletionDue } from "../../lib/trial";

const now = new Date("2026-11-01T00:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

// THE BUG: warned in this very run → not deleted in the same run
assert.equal(isTrialDeletionDue({ trialEndsAt: h(-1), trialWarningSentAt: now, now }), false);

// warned 23 h ago → still waiting
assert.equal(isTrialDeletionDue({ trialEndsAt: h(-23), trialWarningSentAt: h(-23), now }), false);

// warned 24 h ago and expired → deletion due
assert.equal(isTrialDeletionDue({ trialEndsAt: h(-24), trialWarningSentAt: h(-24), now }), true);

// never warned (email failed) → never deleted
assert.equal(isTrialDeletionDue({ trialEndsAt: h(-72), trialWarningSentAt: null, now }), false);

// not expired yet → not deleted, however old the warning
assert.equal(isTrialDeletionDue({ trialEndsAt: h(2), trialWarningSentAt: h(-48), now }), false);

// no end date (the prod admin) → never deleted
assert.equal(isTrialDeletionDue({ trialEndsAt: null, trialWarningSentAt: h(-48), now }), false);

console.log("ALL TRIAL-DELETION TESTS PASSED");
