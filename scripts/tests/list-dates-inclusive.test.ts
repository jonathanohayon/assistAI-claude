// POST /api/calendar/list-dates: `after` is INCLUSIVE and, when present, the
// response says whether the requested date itself is open (has a free slot).
// There is no weekday-to-centre rule any more: a `center` key is ignored and
// "open" means "at least one free slot", the availability slot logic.
//
// Live-call bug this guards: asked "is Tuesday 24 open?" with after =
// 2026-11-24, the old list started on Wed 25 and the agent told the caller
// the place does not open on Tuesdays.
//
// The handlers run for real, outside Next, as the worker (internal secret +
// tenant phone), with an in-memory Google calendar. No DB, no network, frozen
// clock.
// Run with:  npx tsx scripts/tests/list-dates-inclusive.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

const SECRET = "test-internal-secret";
process.env.INTERNAL_SECRET = SECRET;
delete process.env.DATABASE_URL;

// Frozen clock: Monday 2026-11-23 12:00 in Jerusalem (10:00 UTC).
const FIXED = Date.UTC(2026, 10, 23, 10, 0, 0);
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

globalThis.fetch = (async (input: unknown) => {
  throw new Error(`outbound fetch blocked in test: ${String(input)}`);
}) as typeof fetch;

const WORKER_PHONE = "+15555550100";
const WORKER_USER = "user-worker-mock";
// Wed 2026-11-25 is fully booked 09:00–18:00; every other day is free.
const FULL = { id: "full", summary: "Busy", start: { dateTime: "2026-11-25T09:00:00+02:00" }, end: { dateTime: "2026-11-25T18:00:00+02:00" } };
const calendar = { events: { list: async () => ({ data: { items: [FULL] } }) } };

type Body = Record<string, unknown>;

async function post(mod: string, route: string, body: Body): Promise<{ status: number; text: string; json: Body }> {
  const { POST } = await import(mod);
  const res: Response = await POST(
    new NextRequest(`https://example.test/api/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": SECRET, "x-tenant-phone": WORKER_PHONE },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Body };
}

const listDates = (body: Body) =>
  post("../../app/api/calendar/list-dates/route", "calendar/list-dates", body);

const dates = (b: Body) => (b.dates as { date: string }[]).map((d) => d.date);

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

async function main() {
  const google = await import("../../lib/google");
  const deps = google.agentCallerDeps as unknown as Record<string, unknown>;
  deps.auth = async () => null;
  deps.resolveTenantByPhone = async (phone: string) => (phone === WORKER_PHONE ? { user: { id: WORKER_USER } } : null);
  deps.getTenantGoogleClients = async (userId: string) =>
    userId === WORKER_USER ? { calendar, sheets: {}, calendarId: "cal-mock", sheetId: "sheet-mock" } : null;
  // lib/schedule.ts is no longer used by any route; its own helper stays
  // exclusive until its removal step.
  const schedule = await import("../../lib/schedule");

  await test("after on a free day is inclusive: Tue 24 is listed first", async () => {
    const r = await listDates({ center: "jerusalem", count: 3, after: "2026-11-24" });
    assert.equal(r.status, 200);
    assert.deepEqual(dates(r.json), ["2026-11-24", "2026-11-26", "2026-11-27"]);
    assert.equal(r.json.requested_date, "2026-11-24");
    assert.equal(r.json.requested_date_open, true);
  });

  await test("after on a full day: Wed 25 skipped, requested_date_open false", async () => {
    const r = await listDates({ location: null, count: 2, after: "2026-11-25" });
    assert.equal(r.status, 200);
    assert.deepEqual(dates(r.json), ["2026-11-26", "2026-11-27"]);
    assert.equal(r.json.requested_date, "2026-11-25");
    assert.equal(r.json.requested_date_open, false);
  });

  await test("no weekday rule: the same answer for every centre, any centre or none", async () => {
    // Old-worker bodies (no `location` key) all get the same answer.
    const ref = await listDates({ count: 1, after: "2026-11-30" });
    assert.equal(ref.json.requested_date_open, true);
    assert.deepEqual(dates(ref.json), ["2026-11-30"]);
    for (const center of ["natanya", "ashdod", "jerusalem", "haifa", ""]) {
      const r = await listDates({ ...(center ? { center } : {}), count: 1, after: "2026-11-30" });
      assert.equal(r.text, ref.text, String(center));
    }
  });

  await test("response with after: keys in order, location echoed", async () => {
    const r = await listDates({ location: "Mock Studio", count: 1, after: "2026-11-24" });
    assert.deepEqual(Object.keys(r.json), ["location", "dates", "requested_date", "requested_date_open"]);
    assert.equal(
      r.text,
      '{"location":"Mock Studio","dates":[{"date":"2026-11-24"}],"requested_date":"2026-11-24","requested_date_open":true}',
    );
  });

  await test("without after: no requested_* keys, the walk starts tomorrow", async () => {
    const r = await listDates({ center: "jerusalem", count: 3 });
    assert.equal(r.status, 200);
    // Old-worker body: the neutral label and French day names its texts read.
    assert.equal(
      r.text,
      `{"location":null,"label":"l'établissement","dates":[{"date":"2026-11-24","weekday":"mardi"},{"date":"2026-11-26","weekday":"jeudi"},{"date":"2026-11-27","weekday":"vendredi"}]}`,
    );
    const n = await listDates({ location: null, count: 3 });
    assert.equal(n.text, '{"location":null,"dates":[{"date":"2026-11-24"},{"date":"2026-11-26"},{"date":"2026-11-27"}]}');
  });

  await test("bad after is validated as before: ignored, same body as no after", async () => {
    const none = await listDates({ center: "jerusalem", count: 3 });
    for (const after of ["24/11/2026", "2026-11-2", "tomorrow", "", 20261124]) {
      const r = await listDates({ center: "jerusalem", count: 3, after });
      assert.equal(r.status, 200, String(after));
      assert.equal(r.text, none.text, String(after));
    }
  });

  await test("an unknown or missing center is no longer an error (no town list in any body)", async () => {
    for (const body of [{ center: "haifa", after: "2026-11-24" }, { after: "2026-11-24" }, {}]) {
      const r = await listDates(body);
      assert.equal(r.status, 200, r.text);
      assert.doesNotMatch(r.text, /jerusalem|j[ée]rusalem|ashdod|natanya|center invalide|valid_centers/i);
    }
  });

  await test("nextDatesForCenter default stays exclusive (the suggested_dates callers)", () => {
    // Values the pre-fix function returned; the refused date is never suggested.
    assert.deepEqual(
      schedule.nextDatesForCenter("jerusalem", 3, "2026-11-24").map((d) => d.date),
      ["2026-11-26", "2026-11-27", "2026-11-28"],
    );
    assert.deepEqual(
      schedule.nextDatesForCenter("ashdod", 3, "2026-11-23").map((d) => d.date),
      ["2026-11-30", "2026-12-07", "2026-12-14"],
    );
    assert.deepEqual(
      schedule.nextDatesForCenter("natanya", 2, "2026-11-25", {}).map((d) => d.date),
      ["2026-12-02", "2026-12-09"],
    );
    // inclusive has no effect without an explicit after (today never listed).
    assert.deepEqual(
      schedule.nextDatesForCenter("ashdod", 1, undefined, { inclusive: true }).map((d) => d.date),
      ["2026-11-30"],
    );
  });

  console.log(`\nlist-dates-inclusive: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
