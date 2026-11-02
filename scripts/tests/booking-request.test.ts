// Unit tests for parseBookingRequest (lib/booking-request.ts).
// Run with:  npx tsx scripts/tests/booking-request.test.ts

import assert from "node:assert/strict";

import { parseBookingRequest } from "../../lib/booking-request";

const base = { name: " Dana ", phone: "+15550000003", date: "2030-03-05", time: "10:30" };

// a valid request is trimmed and gets the default duration
const ok = parseBookingRequest(base);
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.value.name, "Dana");
  assert.equal(ok.value.duration, 30);
  assert.equal(ok.value.email, undefined);
}

// missing fields and junk bodies -> 400 message, never a throw
for (const bad of [{}, null, "x", { ...base, phone: "" }, { ...base, name: 42 }]) {
  const r = parseBookingRequest(bad);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Champs requis manquants/);
}

// THE BUG: an out-of-range time used to overflow into the next day
for (const time of ["25:99", "24:00", "10h30", "10:60", "abc", "123:00"]) {
  const r = parseBookingRequest({ ...base, time });
  assert.equal(r.ok, false, `time ${time} must be refused`);
  if (!r.ok) assert.match(r.error, /Heure invalide/);
}
assert.ok(parseBookingRequest({ ...base, time: "00:00" }).ok);
assert.ok(parseBookingRequest({ ...base, time: "23:59" }).ok);
// a missing leading zero is normalised, not refused
assert.equal((parseBookingRequest({ ...base, time: "9:30" }) as { value: { time: string } }).value.time, "09:30");

// dates must be real calendar dates in YYYY-MM-DD
for (const date of ["2030-02-30", "2030-13-01", "05/03/2030", "2030-3-5"]) {
  const r = parseBookingRequest({ ...base, date });
  assert.equal(r.ok, false, `date ${date} must be refused`);
  if (!r.ok) assert.match(r.error, /Date invalide/);
}
assert.ok(parseBookingRequest({ ...base, date: "2032-02-29" }).ok); // leap year

// duration: integer minutes between 5 and 480; numeric strings accepted
assert.equal((parseBookingRequest({ ...base, duration: "60" }) as { value: { duration: number } }).value.duration, 60);
for (const duration of [-30, 0, 4, 481, 30.5, "abc", 1440]) {
  const r = parseBookingRequest({ ...base, duration });
  assert.equal(r.ok, false, `duration ${duration} must be refused`);
  if (!r.ok) assert.match(r.error, /Durée invalide/);
}
// null / empty duration falls back to the default
assert.equal((parseBookingRequest({ ...base, duration: null }) as { value: { duration: number } }).value.duration, 30);

console.log("ALL BOOKING-REQUEST TESTS PASSED");
