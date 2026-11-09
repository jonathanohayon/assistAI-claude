// 2026-11 trial: 14 days / 100 min, pause instead of delete (lib/trial.ts).
// Run with:  npx tsx scripts/tests/trial-pause.test.ts

import assert from "node:assert/strict";

import {
  TRIAL_DURATION_MS,
  TRIAL_MINUTES_INCLUDED,
  TRIAL_PAUSED_STATUS,
  TRIAL_WARNING_BEFORE_END_MS,
  computeTrialEndsAt,
  isTrialExhausted,
  isTrialNumberReleaseDue,
  isTrialPauseDue,
} from "../../lib/trial";
import { signupNotice } from "../../lib/auth/provision-tenant";

const DAY = 24 * 3600_000;
const now = new Date("2030-03-15T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * DAY);

// 14 days, 100 minutes, warning 2 days before
assert.equal(TRIAL_DURATION_MS, 14 * DAY);
assert.equal(TRIAL_MINUTES_INCLUDED, 100);
assert.equal(TRIAL_WARNING_BEFORE_END_MS, 2 * DAY);
assert.equal(computeTrialEndsAt(now).getTime(), d(14).getTime());

// exhausted: time OR minutes, and a PAUSED account is always refused
const base = { subscriptionStatus: "trialing", trialEndsAt: d(5), trialSecondsUsed: 0, now };
assert.equal(isTrialExhausted(base), false);
assert.equal(isTrialExhausted({ ...base, trialSecondsUsed: 100 * 60 }), true);
assert.equal(isTrialExhausted({ ...base, trialSecondsUsed: 99 * 60 }), false);
assert.equal(isTrialExhausted({ ...base, trialEndsAt: d(-1) }), true);
assert.equal(isTrialExhausted({ ...base, subscriptionStatus: TRIAL_PAUSED_STATUS }), true);
assert.equal(isTrialExhausted({ ...base, subscriptionStatus: "active", trialEndsAt: d(-1) }), false);
assert.equal(isTrialExhausted({ ...base, subscriptionStatus: TRIAL_PAUSED_STATUS, role: "admin" }), false);

// pause when the trial ended; never an admin, never a paying account
const p = { subscriptionStatus: "trialing", trialEndsAt: d(-0.01), now };
assert.equal(isTrialPauseDue(p), true);
assert.equal(isTrialPauseDue({ ...p, trialEndsAt: d(1) }), false);
assert.equal(isTrialPauseDue({ ...p, role: "admin" }), false);
assert.equal(isTrialPauseDue({ ...p, subscriptionStatus: "active" }), false);
assert.equal(isTrialPauseDue({ ...p, trialEndsAt: null }), false);

// number released only after 30 days paused; account never deleted (no such rule)
const r = { subscriptionStatus: TRIAL_PAUSED_STATUS, trialEndsAt: d(-30), now };
assert.equal(isTrialNumberReleaseDue(r), true);
assert.equal(isTrialNumberReleaseDue({ ...r, trialEndsAt: d(-29) }), false);
assert.equal(isTrialNumberReleaseDue({ ...r, subscriptionStatus: "trialing" }), false);
assert.equal(isTrialNumberReleaseDue({ ...r, subscriptionStatus: "active" }), false);
assert.equal(isTrialNumberReleaseDue({ ...r, role: "admin" }), false);

// founder notification at signup (mock data)
const note = signupNotice({
  email: "new.tenant@example.com", displayName: "Dana", plan: "global", locale: "he",
  trialEndsAt: new Date("2030-03-29T12:00:00Z"),
});
assert.match(note, /Dana <new\.tenant@example\.com>/);
assert.match(note, /Plan: global · language: he/);
assert.match(note, /Trial ends: 2030-03-29 \(14 days \/ 100 min\)/);
assert.match(note, /within 48 h/);

console.log("ALL TRIAL-PAUSE TESTS PASSED");
