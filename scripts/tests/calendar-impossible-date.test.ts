// An impossible date (2026-02-30) is a 400 on every calendar route that takes
// a date, never silently rolled over to another day, and nothing is written.
//
// Part 1: the one validator (lib/iso-date.ts) and lib/schedule.ts.
// Part 2: the handlers run for real, outside Next, as the worker (internal
// secret + tenant phone). The tenant's Google clients are in-memory fakes that
// record every call; any outbound HTTP request is blocked. No DB, no network.
// The valid paths stay byte-identical: calendar-anon-401.test.ts replays its
// recorded fixture.
//
// Run with:  npx tsx scripts/tests/calendar-impossible-date.test.ts

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

import { NextRequest } from "next/server";

import { invalidDateError, isRealIsoDate } from "../../lib/iso-date";
import { centerForDate, nextDatesForCenter } from "../../lib/schedule";

const SECRET = "test-internal-secret";
process.env.INTERNAL_SECRET = SECRET;
delete process.env.DATABASE_URL;
process.env.GOOGLE_CALENDAR_ID = "env-calendar-mock";

// Frozen clock (2025-12-01 10:00 UTC): every 2026+ test date is in the future.
const FIXED = Date.UTC(2025, 11, 1, 10, 0, 0);
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED);
    else super(...(args as [number]));
  }
  static now() {
    return FIXED;
  }
}
globalThis.Date = FixedDate as DateConstructor;

const outbound: string[] = [];
const block = (mod: typeof http | typeof https, proto: string) => {
  const deny = ((..._args: unknown[]) => {
    outbound.push(proto);
    throw new Error(`outbound request blocked in test: ${proto}`);
  }) as typeof http.request;
  mod.request = deny;
  mod.get = deny as unknown as typeof http.get;
};
block(http, "http://");
block(https, "https://");
globalThis.fetch = (async (input: unknown) => {
  outbound.push(`fetch:${String(input)}`);
  throw new Error(`outbound fetch blocked in test: ${String(input)}`);
}) as typeof fetch;

// ── Part 1: the validator ───────────────────────────────────────────────
const TABLE: [string, boolean][] = [
  ["2026-02-30", false],
  ["2026-02-29", false], // 2026 is not a leap year
  ["2028-02-29", true], // 2028 is
  ["2026-13-01", false],
  ["2026-04-31", false],
  ["2026-12-31", true],
  ["2026-01-01", true],
  ["2026-00-10", false],
  ["2026-01-00", false],
  ["2026-1-5", false],
  ["2026-01-05T10:00", false],
  ["", false],
];
for (const [s, ok] of TABLE) assert.equal(isRealIsoDate(s), ok, `isRealIsoDate(${JSON.stringify(s)})`);
for (const v of [undefined, null, 20260105, {}]) assert.equal(isRealIsoDate(v), false, `isRealIsoDate(${String(v)})`);

// lib/schedule.ts: an impossible date throws (it used to roll over to 03-02).
assert.throws(() => centerForDate("2026-02-30"), { message: invalidDateError("2026-02-30") });
assert.throws(() => nextDatesForCenter("ashdod", 3, "2026-02-30"), { message: invalidDateError("2026-02-30") });
// Real dates: unchanged.
assert.equal(centerForDate("2026-03-02"), "ashdod"); // Monday
assert.equal(centerForDate("2028-02-29"), "jerusalem"); // Tuesday
assert.deepEqual(nextDatesForCenter("natanya", 1, "2026-02-28"), [{ date: "2026-03-04", weekday: "mercredi" }]);
console.log("validator table OK");

// ── Part 2: the routes ──────────────────────────────────────────────────
type Call = { api: string; args: unknown };

function fakeGoogle(userId: string, calls: Call[]) {
  const rec = (api: string, data: unknown) => async (args: unknown) => {
    calls.push({ api, args });
    return { data };
  };
  const existing = {
    id: "evt-1",
    summary: "RDV Ashdod — Mock Client",
    description: "Rendez-vous\nTel : +15555550123",
    start: { dateTime: "2026-03-02T11:00:00+02:00" },
    end: { dateTime: "2026-03-02T11:30:00+02:00" },
  };
  return {
    calendar: {
      events: {
        list: rec("calendar.events.list", { items: [existing] }),
        insert: rec("calendar.events.insert", { id: "evt-new", htmlLink: "https://calendar.example.test/evt-new" }),
        get: rec("calendar.events.get", existing),
        patch: rec("calendar.events.patch", existing),
        delete: rec("calendar.events.delete", {}),
      },
    },
    sheets: {},
    calendarId: `cal-${userId}`,
    sheetId: `sheet-${userId}`,
  };
}

const WORKER_PHONE = "+15555550100";
const WORKER_USER = "user-worker-mock";
const BAD = "2026-02-30";

const BOOK = { name: "Mock Client", phone: "+15555550123", time: "14:00", duration: 30 };
const CASES: { route: string; mod: string; body: Record<string, unknown>; error: string }[] = [
  { route: "calendar/availability", mod: "../../app/api/calendar/availability/route", body: { date: BAD, duration: 30 }, error: invalidDateError(BAD) },
  { route: "calendar/availability", mod: "../../app/api/calendar/availability/route", body: { date: BAD, duration: 60, location: "Mock Studio" }, error: invalidDateError(BAD) },
  { route: "calendar/list-dates", mod: "../../app/api/calendar/list-dates/route", body: { center: "ashdod", count: 2, after: BAD }, error: invalidDateError(BAD) },
  { route: "calendar/book", mod: "../../app/api/calendar/book/route", body: { ...BOOK, date: BAD }, error: `Date invalide : ${BAD} (format attendu YYYY-MM-DD)` },
  { route: "calendar/book", mod: "../../app/api/calendar/book/route", body: { ...BOOK, date: BAD, location: "Mock Studio" }, error: `Date invalide : ${BAD} (format attendu YYYY-MM-DD)` },
  { route: "calendar/reschedule", mod: "../../app/api/calendar/reschedule/route", body: { eventId: "evt-1", newDate: BAD, newTime: "15:00" }, error: invalidDateError(BAD) },
  { route: "calendar/reschedule", mod: "../../app/api/calendar/reschedule/route", body: { eventId: "evt-1", newDate: BAD, newTime: "15:00", location: "Mock Studio" }, error: invalidDateError(BAD) },
  { route: "calendar/find", mod: "../../app/api/calendar/find/route", body: { phone: "+15555550123", date: BAD }, error: invalidDateError(BAD) },
];

async function main() {
  const google = await import("../../lib/google");
  const deps = google.agentCallerDeps as unknown as Record<string, unknown>;
  let calls: Call[] = [];
  deps.auth = async () => null;
  deps.resolveTenantByPhone = async (phone: string) => (phone === WORKER_PHONE ? { user: { id: WORKER_USER } } : null);
  deps.getTenantGoogleClients = async (userId: string) => (userId === WORKER_USER ? fakeGoogle(userId, calls) : null);

  async function post(mod: string, route: string, body: Record<string, unknown>) {
    calls = [];
    const { POST } = await import(mod);
    const res: Response = await POST(
      new NextRequest(`https://example.test/api/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET, "x-tenant-phone": WORKER_PHONE },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, google: calls };
  }

  // Every route that takes a date: 400, its existing error text, no Google call.
  for (const c of CASES) {
    const label = `${c.route} ${JSON.stringify(c.body)}`;
    const r = await post(c.mod, c.route, c.body);
    assert.equal(r.status, 400, `${label} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body, { error: c.error }, label);
    assert.deepEqual(r.google, [], `${label} reached Google`);
  }
  console.log(`${CASES.length} impossible-date route cases → 400, no Google call`);

  // The same requests with a real date go through (the day the bad one would
  // have rolled over to, and a leap day).
  {
    const r = await post("../../app/api/calendar/availability/route", "calendar/availability", { date: "2028-02-29", duration: 30 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.date, "2028-02-29");
  }
  {
    const r = await post("../../app/api/calendar/list-dates/route", "calendar/list-dates", { center: "ashdod", count: 1, after: "2026-02-28" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dates, [{ date: "2026-03-02", weekday: "lundi" }]);
  }
  {
    // list-dates: an `after` that is not YYYY-MM-DD is still ignored (from today), as before.
    const r = await post("../../app/api/calendar/list-dates/route", "calendar/list-dates", { center: "ashdod", count: 1, after: "next monday" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dates, [{ date: "2025-12-08", weekday: "lundi" }]);
  }
  {
    const r = await post("../../app/api/calendar/book/route", "calendar/book", { ...BOOK, date: "2026-03-03" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.google.some((c) => c.api === "calendar.events.insert"));
  }
  {
    const r = await post("../../app/api/calendar/reschedule/route", "calendar/reschedule", { eventId: "evt-1", newDate: "2026-03-03", newTime: "15:00", location: "Mock Studio" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.google.some((c) => c.api === "calendar.events.patch"));
  }
  {
    const r = await post("../../app/api/calendar/find/route", "calendar/find", { phone: "+15555550123", date: "2026-03-02" });
    assert.equal(r.status, 200);
    const list = r.google.find((c) => c.api === "calendar.events.list")?.args as { timeMin: string; timeMax: string };
    assert.equal(list.timeMin, "2026-03-01T22:00:00.000Z");
    assert.equal(list.timeMax, "2026-03-02T21:59:59.000Z");
  }
  console.log("real dates: unchanged");

  assert.deepEqual(outbound, [], `outbound requests attempted: ${outbound.join(", ")}`);
  console.log("ALL CALENDAR-IMPOSSIBLE-DATE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
