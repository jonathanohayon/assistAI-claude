// The pure parts of the trial e-mails (lib/trial-end-email.ts): the
// TRIAL_END_EMAIL switch parser, the warning's real days left across time
// zones and late cron runs, the paid-account guard and the error class logged
// on a failed send. The cron itself is covered by trial-cleanup-db.test.ts.
// Run with: npx tsx scripts/tests/trial-end-email.test.ts
import assert from "node:assert/strict";

import {
  mayEmailTrialAccount,
  parseTrialEndEmailSwitch,
  sendErrorClass,
  TRIAL_WARNING_TIME_ZONE,
  trialWarningDays,
} from "@/lib/trial-end-email";
import { TRIAL_WARNING_BEFORE_END_MS } from "@/lib/trial";

// 1. The switch: exactly "on" is on; unset and anything else is off.
assert.equal(parseTrialEndEmailSwitch("on"), "on");
for (const raw of [undefined, null, "", "off", "ON", "On", " on", "on ", "true", "1", "yes", "enabled"])
  assert.equal(parseTrialEndEmailSwitch(raw), "off", `${JSON.stringify(raw)} is off`);

// 2. The warning's days, in the default zone (Asia/Jerusalem, UTC+2 in November).
assert.equal(TRIAL_WARNING_TIME_ZONE, "Asia/Jerusalem");
const at = (iso: string) => new Date(iso);
const NOON = at("2026-11-22T10:00:00Z"); // 12:00 in Jerusalem
assert.equal(trialWarningDays(at("2026-11-22T20:00:00Z"), NOON), 0, "ends tonight 22:00 local -> 0");
assert.equal(trialWarningDays(at("2026-11-22T21:59:00Z"), NOON), 0, "ends 23:59 local -> 0");
assert.equal(trialWarningDays(at("2026-11-22T22:00:00Z"), NOON), 1, "ends at the next local midnight -> 1");
assert.equal(trialWarningDays(at("2026-11-23T21:59:00Z"), NOON), 1, "ends tomorrow 23:59 local -> 1");
assert.equal(trialWarningDays(at("2026-11-23T22:00:00Z"), NOON), 2, "ends the day after tomorrow -> 2");
assert.equal(trialWarningDays(at("2026-11-24T09:59:00Z"), NOON), 2, "ends just under 48 h later -> 2");
// Ended: no warning at all.
assert.equal(trialWarningDays(NOON, NOON), null, "ends now -> skipped");
assert.equal(trialWarningDays(at("2026-11-22T09:00:00Z"), NOON), null, "ended an hour ago -> skipped");

// Late runs: the cron runs at 23:30 local.
const LATE = at("2026-11-22T21:30:00Z");
assert.equal(trialWarningDays(at("2026-11-22T21:45:00Z"), LATE), 0, "late run, ends in 15 min -> 0");
assert.equal(trialWarningDays(at("2026-11-22T22:15:00Z"), LATE), 1, "late run, ends just after local midnight -> 1");
assert.equal(trialWarningDays(at("2026-11-24T21:00:00Z"), LATE), 2, "late run, ends 47.5 h later -> 2");

// Other zones: the same instants, other local midnights.
assert.equal(trialWarningDays(at("2026-11-22T20:00:00Z"), NOON, "UTC"), 0);
assert.equal(trialWarningDays(at("2026-11-23T01:00:00Z"), NOON, "UTC"), 1);
assert.equal(trialWarningDays(at("2026-11-23T01:00:00Z"), NOON, "Asia/Jerusalem"), 1);
assert.equal(trialWarningDays(at("2026-11-23T01:00:00Z"), NOON, "America/New_York"), 0, "20:00 New York, same day");
assert.equal(trialWarningDays(at("2026-11-22T16:00:00Z"), NOON, "Asia/Tokyo"), 1, "01:00 Tokyo, next day");
assert.equal(trialWarningDays(at("2026-11-22T14:00:00Z"), NOON, "Asia/Tokyo"), 0, "23:00 Tokyo, same day");

// Across the end of daylight saving time in Israel (2026-10-25, 02:00 -> 01:00).
assert.equal(trialWarningDays(at("2026-10-26T21:00:00Z"), at("2026-10-24T20:00:00Z")), 2, "23:00 IDT -> 23:00 IST two days later");
assert.equal(trialWarningDays(at("2026-10-25T21:59:00Z"), at("2026-10-24T20:30:00Z")), 1, "23:30 IDT to 23:59 IST the next day (a 25-hour day) is one day");
assert.equal(trialWarningDays(at("2026-10-25T21:59:00Z"), at("2026-10-24T21:30:00Z")), 0, "00:30 IDT to 23:59 IST the same day is 0");

// Every hourly (and every 7-minute) run inside the 2-day window gives 0, 1 or
// 2, never more as the run gets later, and 0 on the last local day.
for (const zone of ["Asia/Jerusalem", "Europe/Paris", "America/Los_Angeles", "Pacific/Auckland"]) {
  for (const end of [at("2026-11-24T10:00:00Z"), at("2026-11-24T22:30:00Z"), at("2026-03-29T00:30:00Z")]) {
    let prev = Infinity;
    for (let t = end.getTime() - TRIAL_WARNING_BEFORE_END_MS + 1; t < end.getTime(); t += 7 * 60_000) {
      const d = trialWarningDays(end, new Date(t), zone);
      assert.ok(d === 0 || d === 1 || d === 2, `${zone} ${end.toISOString()} at ${new Date(t).toISOString()}: ${d}`);
      assert.ok(d <= prev, `${zone}: days never go up as the run gets later`);
      prev = d;
    }
    assert.equal(trialWarningDays(end, new Date(end.getTime() - 60_000), zone), 0, `${zone}: a minute before the end -> 0`);
  }
}

// 3. The paid / admin guard.
assert.equal(mayEmailTrialAccount({ hasPaidOrder: false, role: "user" }), true);
assert.equal(mayEmailTrialAccount({ hasPaidOrder: false, role: null }), true);
assert.equal(mayEmailTrialAccount({ hasPaidOrder: true, role: "user" }), false, "a paid account is never e-mailed");
assert.equal(mayEmailTrialAccount({ hasPaidOrder: false, role: "admin" }), false, "an admin is never e-mailed");
assert.equal(mayEmailTrialAccount({ hasPaidOrder: true, role: "admin" }), false);

// 4. The error class: never the message (it can quote the recipient).
assert.equal(sendErrorClass("validation_error: Invalid `to` field: dana@example.com"), "validation_error");
assert.equal(sendErrorClass("rate_limit_exceeded: too many"), "rate_limit_exceeded");
const typeErr = new TypeError("fetch failed for dana@example.com");
assert.equal(sendErrorClass(typeErr), "TypeError");
assert.equal(sendErrorClass(undefined), "unknown");
assert.equal(sendErrorClass(""), "unknown");
assert.equal(sendErrorClass("dana@example.com rejected"), "unknown", "a string without a class prefix is unknown");
assert.equal(sendErrorClass("dana@example.com: rejected"), "unknown", "an address is never a class");
assert.equal(sendErrorClass("Resend error"), "unknown");
assert.equal(sendErrorClass(`${"x".repeat(200)}: boom`), "unknown", "an over-long prefix is not a class");
assert.equal(sendErrorClass({ message: "dana@example.com" }), "unknown");

console.log("trial-end-email: ok");
