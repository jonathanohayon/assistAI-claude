// Unit tests for lib/booking-place.ts (generic booking place).
// Run with:  npx tsx scripts/tests/booking-place.test.ts
import assert from "node:assert/strict";

import { atPlace, eventPlaceLine, eventTitle, locationLabel, nameFromTitle, resolvePlace } from "../../lib/booking-place";
import { CENTERS, validateBooking } from "../../lib/schedule";

// LEGACY (no `location` key): exactly today's behaviour and texts, for every
// weekday × every requested centre (or none).
const dates = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
let n = 0;
for (const date of dates) {
  for (const requested of [null, ...CENTERS]) {
    const body = requested ? { center: requested } : {};
    const got = resolvePlace(body, date);
    const old = validateBooking(date, requested);
    if (!old.ok) {
      assert.ok(!got.ok && got.kind === "wrong_center");
      assert.deepEqual(got.refusal, old);
    } else {
      assert.ok(got.ok && got.place.kind === "legacy");
      const p = got.place;
      assert.equal(p.kind === "legacy" && p.center, old.center);
      // The former expressions, verbatim:
      assert.equal(eventTitle(p, "Dana"), `RDV ${old.label} — Dana`);
      assert.equal(eventPlaceLine(p), `Centre : ${old.label}`);
      assert.equal(`pour Dana${atPlace(p)}`, `pour Dana à ${old.label}`);
      assert.equal(nameFromTitle(`RDV ${old.label} — Dana`, p), "Dana");
      assert.equal(nameFromTitle("RDV — Dana", p), null, "legacy keeps its former pattern");
    }
    n++;
  }
}
assert.equal(n, 28);
assert.deepEqual(resolvePlace({ center: "jerusalem" }, "nope"), {
  ok: false, kind: "invalid_date", error: "date invalide : nope (YYYY-MM-DD attendu)",
});

// NEW (`location` key present): NO weekday rule, whatever the day or centre.
for (const date of dates) {
  for (const center of [undefined, ...CENTERS]) {
    const r = resolvePlace({ location: "Salon Rivoli", ...(center ? { center } : {}) }, date);
    assert.deepEqual(r, { ok: true, place: { kind: "location", label: "Salon Rivoli" } });
  }
}
const none = resolvePlace({ location: null }, "2026-11-16");
assert.ok(none.ok);
const p0 = none.place;
assert.equal(eventTitle(p0, "Dana"), "RDV — Dana");
assert.equal(eventPlaceLine(p0), "");
assert.equal(atPlace(p0), "");
assert.equal(nameFromTitle("RDV — Dana", p0), "Dana");
const named = resolvePlace({ location: "  Salon Rivoli " }, "2026-11-16");
assert.ok(named.ok);
assert.equal(eventTitle(named.place, "Dana"), "RDV Salon Rivoli — Dana");
assert.equal(eventPlaceLine(named.place), "Lieu : Salon Rivoli");
assert.equal(nameFromTitle("RDV Jérusalem — Dana", named.place), "Dana");
assert.equal(locationLabel("x".repeat(500))?.length, 120);
assert.equal(locationLabel(42), null);

// No first-customer fact in the new path's texts.
const FACTS = /jérusalem|jerusalem|ashdod|natanya|netanya|prestige|centre :/i;
for (const r of [none, named]) {
  assert.ok(r.ok);
  for (const t of [eventTitle(r.place, "Dana"), eventPlaceLine(r.place), atPlace(r.place)]) assert.doesNotMatch(t, FACTS);
}

console.log("ALL BOOKING-PLACE TESTS PASSED");
