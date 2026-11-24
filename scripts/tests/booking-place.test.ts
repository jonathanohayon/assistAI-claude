// Unit tests for lib/booking-place.ts (generic booking place).
// Run with:  npx tsx scripts/tests/booking-place.test.ts
import assert from "node:assert/strict";

import { atPlace, eventPlaceLine, eventTitle, locationLabel, nameFromTitle, resolvePlace } from "../../lib/booking-place";
import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const NONE = { kind: "location", label: null };

// Old worker body (no `location` key): exactly the new shape with location
// null, whatever the centre asked for; the centre is flagged as ignored.
for (const center of ["jerusalem", "ashdod", "natanya", "haifa", "", 42, null]) {
  assert.deepEqual(resolvePlace({ center }), { place: NONE, ignoredCenter: true }, `old worker body center ${String(center)}`);
}
assert.deepEqual(resolvePlace({}), { place: NONE, ignoredCenter: false }, "old worker body without center");
assert.deepEqual(resolvePlace({ location: null }), { place: NONE, ignoredCenter: false });

// New worker body (`location` key present): the tenant's place; a stray
// centre next to it is not a legacy request (nothing to log).
for (const center of [undefined, "jerusalem", "ashdod", "natanya"]) {
  const r = resolvePlace({ location: "Salon Rivoli", ...(center ? { center } : {}) });
  assert.deepEqual(r, { place: { kind: "location", label: "Salon Rivoli" }, ignoredCenter: false });
}

const p0 = resolvePlace({ center: "natanya" }).place;
assert.equal(eventTitle(p0, "Dana"), "RDV — Dana");
assert.equal(eventPlaceLine(p0), "");
assert.equal(atPlace(p0), "");
assert.equal(nameFromTitle("RDV — Dana"), "Dana");
const named = resolvePlace({ location: "  Salon Rivoli " }).place;
assert.equal(eventTitle(named, "Dana"), "RDV Salon Rivoli — Dana");
assert.equal(eventPlaceLine(named), "Lieu : Salon Rivoli");
assert.equal(atPlace(named), " à Salon Rivoli");
// A title written before this change ("RDV <centre> — <name>") still yields the name.
assert.equal(nameFromTitle("RDV Studio Nord — Dana"), "Dana");
assert.equal(nameFromTitle("Custom title"), null);
assert.equal(locationLabel("x".repeat(500))?.length, 120);
assert.equal(locationLabel(42), null);
assert.equal(locationLabel("   "), null);

// No first-customer fact in any text, for either shape.
for (const body of [{ center: "jerusalem" }, { center: "ashdod" }, { center: "natanya" }, {}, { location: null }, { location: "Salon Rivoli" }]) {
  const { place } = resolvePlace(body);
  for (const t of [eventTitle(place, "Dana"), eventPlaceLine(place), atPlace(place)]) {
    assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS);
    assert.doesNotMatch(t, /centre :/i);
  }
}

console.log("ALL BOOKING-PLACE TESTS PASSED");
