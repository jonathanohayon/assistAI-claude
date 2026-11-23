// POST /api/calendar/list-dates: `after` is INCLUSIVE and, when present, the
// response says whether the requested date itself is open for the centre.
// The error paths that suggest ALTERNATIVES (availability / book / reschedule
// suggested_dates) keep excluding the date that was just refused.
//
// Live-call bug this guards: asked "is Tuesday 24 open?" for Jérusalem with
// after = 2026-11-24, the old list started on Wed 25 and the agent told the
// caller the centre does not open on Tuesdays.
//
// The handlers run for real, outside Next. No DB, no network, frozen clock.
// Run with:  npx tsx scripts/tests/list-dates-inclusive.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

const SECRET = "test-internal-secret";
process.env.INTERNAL_SECRET = SECRET;
delete process.env.DATABASE_URL;

// Frozen clock: Monday 2026-11-23 12:00 in Jerusalem (10:00 UTC).
// Calendar that week: Mon 23 (Ashdod), Tue 24 (Jérusalem), Wed 25 (Natanya),
// Thu 26 / Fri 27 / Sat 28 / Sun 29 (Jérusalem), Mon 30 (Ashdod).
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

type Body = Record<string, unknown>;

async function post(mod: string, route: string, body: Body): Promise<{ status: number; text: string; json: Body }> {
  const { POST } = await import(mod);
  const res: Response = await POST(
    new NextRequest(`https://example.test/api/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": SECRET },
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
  const schedule = await import("../../lib/schedule");

  await test("after on a valid day is inclusive: Tue for Jerusalem lists Tue first", async () => {
    const r = await listDates({ center: "jerusalem", count: 3, after: "2026-11-24" });
    assert.equal(r.status, 200);
    assert.deepEqual(dates(r.json), ["2026-11-24", "2026-11-26", "2026-11-27"]);
    assert.equal(r.json.requested_date, "2026-11-24");
    assert.equal(r.json.requested_date_open, true);
  });

  await test("after on a non-matching day: Wed for Jerusalem lists Thu first, requested_date_open false", async () => {
    const r = await listDates({ center: "jerusalem", count: 2, after: "2026-11-25" });
    assert.equal(r.status, 200);
    assert.deepEqual(dates(r.json), ["2026-11-26", "2026-11-27"]);
    assert.equal(r.json.requested_date, "2026-11-25");
    assert.equal(r.json.requested_date_open, false);
  });

  await test("requested_date_open follows centerForDate for every centre", async () => {
    // Wed 25 is Natanya's day: open for natanya, closed for the two others.
    for (const [center, open] of [["natanya", true], ["ashdod", false], ["jerusalem", false]] as const) {
      const r = await listDates({ center, count: 1, after: "2026-11-25" });
      assert.equal(r.json.requested_date_open, open, center);
      assert.equal(r.json.requested_date_open, schedule.centerForDate("2026-11-25") === center);
    }
    // Mon 30 for Ashdod: open, and listed first.
    const r = await listDates({ center: "ashdod", count: 2, after: "2026-11-30" });
    assert.equal(r.json.requested_date_open, true);
    assert.deepEqual(dates(r.json), ["2026-11-30", "2026-12-07"]);
  });

  await test("response with after: existing keys first, in their order, then the two new keys", async () => {
    const r = await listDates({ center: "jerusalem", count: 1, after: "2026-11-24" });
    assert.deepEqual(Object.keys(r.json), ["center", "label", "dates", "requested_date", "requested_date_open"]);
    assert.equal(
      r.text,
      '{"center":"jerusalem","label":"Jérusalem","dates":[{"date":"2026-11-24","weekday":"mardi"}],"requested_date":"2026-11-24","requested_date_open":true}',
    );
  });

  await test("without after: no new keys, byte-identical to before (walk starts tomorrow)", async () => {
    const r = await listDates({ center: "jerusalem", count: 3 });
    assert.equal(r.status, 200);
    assert.equal(
      r.text,
      '{"center":"jerusalem","label":"Jérusalem","dates":[{"date":"2026-11-24","weekday":"mardi"},{"date":"2026-11-26","weekday":"jeudi"},{"date":"2026-11-27","weekday":"vendredi"}]}',
    );
    // Today (Mon 23, Ashdod's day) is still never listed without after.
    const a = await listDates({ center: "ashdod", count: 1 });
    assert.equal(a.text, '{"center":"ashdod","label":"Ashdod","dates":[{"date":"2026-11-30","weekday":"lundi"}]}');
  });

  await test("bad after is validated as before: ignored, same body as no after", async () => {
    const none = await listDates({ center: "jerusalem", count: 3 });
    for (const after of ["24/11/2026", "2026-11-2", "tomorrow", "", 20261124]) {
      const r = await listDates({ center: "jerusalem", count: 3, after });
      assert.equal(r.status, 200, String(after));
      assert.equal(r.text, none.text, String(after));
    }
  });

  await test("bad center is still a 400 with the same body", async () => {
    const r = await listDates({ center: "haifa", after: "2026-11-24" });
    assert.equal(r.status, 400);
    assert.equal(
      r.text,
      '{"error":"center invalide. Valeurs : jerusalem, ashdod, natanya","valid_centers":["jerusalem","ashdod","natanya"]}',
    );
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

  await test("availability wrong_day_for_center: suggested_dates byte-identical, requested date excluded", async () => {
    // Ashdod asked on Mon 30 would be right; ask Ashdod on Tue 24 (Jérusalem's day).
    const r = await post("../../app/api/calendar/availability/route", "calendar/availability", {
      date: "2026-11-24",
      center: "ashdod",
    });
    assert.equal(r.status, 200);
    assert.equal(
      r.text,
      '{"error":"wrong_day_for_center","date":"2026-11-24","weekday":"mardi","requested_center":"ashdod","open_center_that_day":"jerusalem","open_label_that_day":"Jérusalem","suggested_dates":[{"date":"2026-11-30","weekday":"lundi"},{"date":"2026-12-07","weekday":"lundi"},{"date":"2026-12-14","weekday":"lundi"}],"message":"Le 2026-11-24 (mardi), seul Jérusalem est ouvert. Prochaines dates pour Ashdod : lundi 2026-11-30, lundi 2026-12-07, lundi 2026-12-14."}',
    );
    // Ashdod on its own day (Mon 30) but routed as wrong_day by asking Jérusalem:
    // the suggestions for Jérusalem start after Mon 30, not on it.
    const j = await post("../../app/api/calendar/availability/route", "calendar/availability", {
      date: "2026-11-30",
      center: "jerusalem",
    });
    const s = (j.json.suggested_dates as { date: string }[]).map((d) => d.date);
    assert.deepEqual(s, ["2026-12-01", "2026-12-03", "2026-12-04"]);
  });

  console.log(`\nlist-dates-inclusive: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
