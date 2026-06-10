// Regression test for the booking overlap guard (lib/calendar-conflict.ts).
//
// No test framework is installed — plain tsx + node:assert/strict.
// Run with:  npx tsx scripts/tests/calendar-conflict.test.ts
// Exits non-zero on the first failing assertion.
//
// WHY THIS EXISTS
// ---------------
// The voice agent kept booking OVERLAPPING appointments no matter how firmly
// the prompt forbade it — because the LLM can't reliably reason about time
// arithmetic, and the book endpoint inserted events with ZERO collision check.
// The fix moves the rule into deterministic server code. This locks in the two
// guarantees that code must keep:
//
//   1. A service overlaps an existing booking iff the half-open intervals
//      [start, start+duration) and [busyStart, busyEnd) intersect. Edge-touching
//      (an event ending at 11:00 vs a booking starting at 11:00) is NOT a clash.
//   2. Availability respects the FULL service duration: a 60-min service must
//      NOT be offered 11:00 when 11:30 is already booked (the original bug),
//      even though the bare 11:00–11:30 window looks free.

import assert from "node:assert/strict";

import {
  freeSlotsFromBusy,
  intervalsOverlap,
  type BusyInterval,
} from "@/lib/calendar-conflict";
import { jerusalemToUTCISO } from "@/lib/tz";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A weekday well in the future so the "too soon" buffer never hides slots.
const DATE = "2099-06-10";
const NOW = 0; // epoch — everything on DATE is "future"
const at = (hhmm: string) =>
  new Date(jerusalemToUTCISO(DATE, `${hhmm}:00`)).getTime();
const busyAt = (startHHMM: string, endHHMM: string): BusyInterval => ({
  s: at(startHHMM),
  e: at(endHHMM),
});

console.log("intervalsOverlap:");

check("overlapping intervals are detected", () => {
  // 10:30–11:30 (60-min service) vs 11:00–11:30 booking → overlap.
  assert.equal(intervalsOverlap(at("10:30"), at("11:30"), at("11:00"), at("11:30")), true);
});

check("edge-touching is NOT an overlap (event ends when next starts)", () => {
  // 10:00–11:00 vs 11:00–12:00 → adjacent, allowed.
  assert.equal(intervalsOverlap(at("11:00"), at("12:00"), at("10:00"), at("11:00")), false);
});

check("fully-contained busy interval is detected", () => {
  // 09:00–18:00 all-day-ish block contains any 30-min slot.
  assert.equal(intervalsOverlap(at("14:00"), at("14:30"), at("09:00"), at("18:00")), true);
});

console.log("freeSlotsFromBusy:");

check("THE BUG: 60-min service is not offered 11:00 when 11:30 is booked", () => {
  const busy = [busyAt("11:30", "12:00")];
  const slots = freeSlotsFromBusy(DATE, 60, busy, NOW);
  // 11:00 start + 60 min would run to 12:00 and hit the 11:30 booking.
  assert.equal(slots.includes("11:00"), false, "11:00 must be blocked for 60-min");
  assert.equal(slots.includes("11:30"), false, "11:30 itself is busy");
  // 10:00 (→11:00) and 12:00 (→13:00) are clear.
  assert.equal(slots.includes("10:00"), true);
  assert.equal(slots.includes("12:00"), true);
});

check("same slot IS offered for a 30-min service", () => {
  const busy = [busyAt("11:30", "12:00")];
  const slots = freeSlotsFromBusy(DATE, 30, busy, NOW);
  // 11:00 start + 30 min ends 11:30 — edge-touches the booking, allowed.
  assert.equal(slots.includes("11:00"), true);
  assert.equal(slots.includes("11:30"), false);
});

check("service is never offered past closing time (18:00)", () => {
  const slots = freeSlotsFromBusy(DATE, 60, [], NOW);
  // 17:00 start + 60 = 18:00 OK; 17:30 + 60 = 18:30 past close → excluded.
  assert.equal(slots.includes("17:00"), true);
  assert.equal(slots.includes("17:30"), false);
});

check("transparent / all-day events don't block (already filtered upstream)", () => {
  // freeSlotsFromBusy only sees real busy intervals; empty ⇒ full day open.
  const slots = freeSlotsFromBusy(DATE, 30, [], NOW);
  assert.equal(slots.includes("09:00"), true);
  assert.equal(slots.length > 0, true);
});

console.log(`\n${passed} assertions passed.`);
