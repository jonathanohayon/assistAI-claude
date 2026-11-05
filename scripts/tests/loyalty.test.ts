// Loyalty v1 (lib/loyalty.ts, lib/loyalty-profile.ts). Mock numbers only.
// Run with:  npx tsx scripts/tests/loyalty.test.ts

import assert from "node:assert/strict";

import {
  REGULAR_MIN_VISITS,
  buildClientProfile,
  clientPhoneKey,
  visitChangeFromEvent,
} from "../../lib/loyalty";

async function main() {
  assert.equal(REGULAR_MIN_VISITS, 3);

  // booking made by the agent: "RDV <centre> — <name>", "Tel : <phone>"
  const booked = visitChangeFromEvent({
    id: "evt-1",
    status: "confirmed",
    summary: "RDV Centre Test — Dana Mock",
    description: "Centre : Centre Test\nTel : 050-000-0001",
    start: { dateTime: "2026-10-01T09:00:00+03:00" },
  });
  assert.deepEqual(booked, {
    kind: "upsert",
    eventId: "evt-1",
    clientPhone: "+972500000001",
    clientName: "Dana Mock",
    startsAt: new Date("2026-10-01T06:00:00Z"),
  });

  // deleted event as returned with showDeleted: id + status only
  assert.deepEqual(visitChangeFromEvent({ id: "evt-1", status: "cancelled" }), {
    kind: "cancel",
    eventId: "evt-1",
  });
  // owner's private event without a client phone: not a visit
  assert.equal(visitChangeFromEvent({ id: "evt-2", summary: "Lunch", start: { dateTime: "2026-10-01T12:00:00Z" } }), null);
  assert.equal(visitChangeFromEvent({ id: "", summary: "x" }), null);

  // profile: past visits only count, cancelled never, regular at 3
  const now = new Date("2026-11-05T10:00:00Z");
  const row = (iso: string, cancelled = false, clientName = "Dana Mock") => ({
    clientName,
    startsAt: new Date(iso),
    cancelled,
  });
  assert.equal(buildClientProfile([], now), null);
  assert.equal(buildClientProfile([row("2026-10-01T06:00:00Z", true)], now), null);

  const two = buildClientProfile(
    [row("2026-09-01T06:00:00Z"), row("2026-10-01T06:00:00Z"), row("2026-10-15T06:00:00Z", true), row("2026-11-20T06:00:00Z")],
    now,
  );
  assert.deepEqual(two, {
    visits: 2,
    lastVisitAt: "2026-10-01T06:00:00.000Z",
    nextVisitAt: "2026-11-20T06:00:00.000Z",
    regular: false,
    name: "Dana Mock",
  });
  const three = buildClientProfile(
    [row("2026-08-01T06:00:00Z", false, ""), row("2026-09-01T06:00:00Z"), row("2026-10-01T06:00:00Z", false, "")],
    now,
  );
  assert.equal(three?.visits, 3);
  assert.equal(three?.regular, true);
  assert.equal(three?.name, "Dana Mock");

  // caller formats from SIP → same key as bookings
  assert.equal(clientPhoneKey("+972500000001"), "+972500000001");
  assert.equal(clientPhoneKey("0500000001"), "+972500000001");
  assert.equal(clientPhoneKey(""), null);
  assert.equal(clientPhoneKey(null), null);

  // the lookup gives up after the timeout instead of delaying the call
  process.env.DATABASE_URL ??= "postgres://mock:mock@127.0.0.1:1/mock";
  const { getClientProfile } = await import("../../lib/loyalty-profile");
  assert.equal(await getClientProfile("00000000-0000-0000-0000-000000000000", "", 300), null);
  const t0 = Date.now();
  const slow = await getClientProfile("00000000-0000-0000-0000-000000000000", "+972500000001", 50);
  assert.equal(slow, null);
  assert.ok(Date.now() - t0 < 1000, "must not wait for the DB");

  console.log("ALL LOYALTY TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
