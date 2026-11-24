// The calendar routes (availability, book, reschedule, list-dates) apply NO
// weekday-to-centre rule, for any request shape. The first customer's towns
// never reach a call: not in a response, an error, an event title or an event
// description.
//
// Two request shapes, both tested on every route:
//   - "old worker body": a `center` key (or none), NO `location` key. Handled
//     EXACTLY like the new worker body with `location: null`; `center` ignored.
//   - "new worker body": a `location` key (string or null), no `center`.
//     Byte-identical to before this change on availability / book /
//     reschedule (literals recorded from the pre-change routes with the same
//     fake Google). list-dates had no new-shape path (it required a centre);
//     its new behaviour is pinned here.
//
// The handlers run for real, outside Next, as the worker (internal secret +
// tenant phone). The tenant's Google clients are in-memory fakes that record
// every call; any outbound HTTP request is blocked. No DB, no network.
//
// Run with:  npx tsx scripts/tests/calendar-no-first-customer-towns.test.ts
//   (RECORD=1 prints the new-worker outcomes as JSON instead of asserting.)

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

import { NextRequest } from "next/server";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const SECRET = "test-internal-secret";
process.env.INTERNAL_SECRET = SECRET;
delete process.env.DATABASE_URL;
process.env.GOOGLE_CALENDAR_ID = "env-calendar-mock";

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

const outbound: string[] = [];
const block = (mod: typeof http | typeof https, proto: string) => {
  const deny = (() => {
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

// The three towns in every spelling seen (fr / en / he), on top of the shared list.
const TOWNS = /natan[iy]a|netan[iy]a|j[ée]rusal[ae]m|yerushalayim|ashdod|ירושלים|אשדוד|נתניה/i;

type Call = { api: string; args: unknown };

// Busy calendar: Tue 2026-11-24 is fully booked 09:00–18:00 (no free slot);
// one 11:00–11:30 booking every other day. The event being rescheduled uses
// the title shape the routes write ("RDV — <name>").
const FULL_DAY = "2026-11-24";
function fakeGoogle(userId: string, calls: Call[]) {
  const rec = (api: string, data: (args: unknown) => unknown) => async (args: unknown) => {
    calls.push({ api, args });
    return { data: data(args) };
  };
  const existing = {
    id: "evt-1",
    summary: "RDV — Mock Client",
    description: "Rendez-vous\nTel : +15555550123",
    start: { dateTime: "2026-11-30T11:00:00+02:00" },
    end: { dateTime: "2026-11-30T11:30:00+02:00" },
  };
  const list = (args: unknown) => {
    const { timeMin, timeMax } = args as { timeMin: string; timeMax: string };
    const items: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      const day = new RealDate(RealDate.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10);
      const ev =
        day === FULL_DAY
          ? { id: `full-${day}`, summary: "Busy", start: { dateTime: `${day}T09:00:00+02:00` }, end: { dateTime: `${day}T18:00:00+02:00` } }
          : { id: `b-${day}`, summary: "Busy", start: { dateTime: `${day}T11:00:00+02:00` }, end: { dateTime: `${day}T11:30:00+02:00` } };
      const s = new RealDate(ev.start.dateTime).getTime();
      const e = new RealDate(ev.end.dateTime).getTime();
      if (s < new RealDate(timeMax).getTime() && e > new RealDate(timeMin).getTime()) items.push(ev);
    }
    return { items };
  };
  return {
    calendar: {
      events: {
        list: rec("calendar.events.list", list),
        insert: rec("calendar.events.insert", () => ({ id: "evt-new", htmlLink: "https://calendar.example.test/evt-new" })),
        get: rec("calendar.events.get", () => existing),
        patch: rec("calendar.events.patch", () => existing),
        delete: rec("calendar.events.delete", () => ({})),
      },
    },
    sheets: {},
    calendarId: `cal-${userId}`,
    sheetId: `sheet-${userId}`,
  };
}

const WORKER_PHONE = "+15555550100";
const WORKER_USER = "user-worker-mock";
const CENTERS = ["natanya", "ashdod", "jerusalem"] as const;
// Mon (the former Ashdod day), Tue (fully booked), Wed (the former Natanya day), Thu.
const DATES = ["2026-11-30", FULL_DAY, "2026-11-25", "2026-11-26"];
const BOOK = { name: "Mock Client", phone: "+15555550123", time: "14:00", duration: 30 };

const ROUTE = {
  availability: "../../app/api/calendar/availability/route",
  book: "../../app/api/calendar/book/route",
  reschedule: "../../app/api/calendar/reschedule/route",
  listDates: "../../app/api/calendar/list-dates/route",
} as const;

type Outcome = { status: number; text: string; google: Call[] };

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

async function main() {
  const google = await import("../../lib/google");
  const deps = google.agentCallerDeps as unknown as Record<string, unknown>;
  let calls: Call[] = [];
  deps.auth = async () => null;
  deps.resolveTenantByPhone = async (phone: string) => (phone === WORKER_PHONE ? { user: { id: WORKER_USER } } : null);
  deps.getTenantGoogleClients = async (userId: string) => (userId === WORKER_USER ? fakeGoogle(userId, calls) : null);

  // Console output of the routes, to prove the ignored centre is logged
  // without its value.
  const consoleLines: string[] = [];
  const realInfo = console.info;
  console.info = (...a: unknown[]) => {
    consoleLines.push(a.map(String).join(" "));
  };

  async function post(route: keyof typeof ROUTE, body: Record<string, unknown>): Promise<Outcome> {
    calls = [];
    const { POST } = await import(ROUTE[route]);
    const res: Response = await POST(
      new NextRequest(`https://example.test/api/calendar/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET, "x-tenant-phone": WORKER_PHONE },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, text: await res.text(), google: JSON.parse(JSON.stringify(calls)) };
  }
  /** What the route wrote to Google (titles, descriptions), as text. The IANA
   *  time zone "Asia/Jerusalem" of every event is a clock setting, not a place. */
  const writes = (o: Outcome) =>
    JSON.stringify(o.google.filter((c) => c.api === "calendar.events.insert" || c.api === "calendar.events.patch")).replaceAll(
      '"timeZone":"Asia/Jerusalem"',
      '"timeZone":"<tz>"',
    );

  // ── New worker bodies: byte-identical to before ────────────────────────
  const NEW_CASES: [string, keyof typeof ROUTE, Record<string, unknown>][] = [
    ["availability location string", "availability", { date: "2026-11-30", duration: 60, location: "Mock Studio" }],
    ["availability location null", "availability", { date: "2026-11-25", duration: 30, location: null }],
    ["availability location null, full day", "availability", { date: FULL_DAY, location: null }],
    ["book location string", "book", { ...BOOK, date: "2026-11-30", location: "Mock Studio" }],
    ["book location null", "book", { ...BOOK, date: "2026-11-25", location: null }],
    ["book location null, conflict", "book", { ...BOOK, date: "2026-11-26", time: "11:00", location: null }],
    ["reschedule location string", "reschedule", { eventId: "evt-1", newDate: "2026-11-25", newTime: "15:00", location: "Mock Studio" }],
    ["reschedule location null", "reschedule", { eventId: "evt-1", newDate: "2026-11-26", newTime: "15:00", location: null }],
  ];
  if (process.env.RECORD === "1") {
    const out: Record<string, Outcome> = {};
    for (const [name, route, body] of NEW_CASES) out[name] = await post(route, body);
    console.info = realInfo;
    console.log(JSON.stringify(out));
    return;
  }

  await test("new worker body: availability / book / reschedule byte-identical to before", async () => {
    for (const [name, route, body] of NEW_CASES) {
      const got = await post(route, body);
      assert.deepEqual(got, BEFORE[name], name);
    }
  });

  await test("new worker body: list-dates with location (string or null), no center → free-slot dates", async () => {
    const r = await post("listDates", { location: "Mock Studio", count: 3, after: "2026-11-23" });
    assert.equal(r.status, 200, r.text);
    // Mon 23: from 12:00 local the 30-min buffer leaves slots → listed; Tue 24 full → skipped.
    assert.equal(
      r.text,
      '{"location":"Mock Studio","dates":[{"date":"2026-11-23"},{"date":"2026-11-25"},{"date":"2026-11-26"}],"requested_date":"2026-11-23","requested_date_open":true}',
    );
    const n = await post("listDates", { location: null, count: 2, after: FULL_DAY });
    assert.equal(
      n.text,
      '{"location":null,"dates":[{"date":"2026-11-25"},{"date":"2026-11-26"}],"requested_date":"2026-11-24","requested_date_open":false}',
    );
    // ONE Google read over the 30-day horizon (08:00 first day → 20:00 last day, Jerusalem).
    const lists = n.google.filter((c) => c.api === "calendar.events.list");
    assert.equal(lists.length, 1);
    const a = lists[0].args as { timeMin: string; timeMax: string; calendarId: string };
    assert.equal(a.calendarId, `cal-${WORKER_USER}`);
    assert.equal(a.timeMin, "2026-11-24T06:00:00.000Z");
    assert.equal(a.timeMax, "2026-12-23T18:00:00.000Z");
    // Without after: starts tomorrow, no requested_* keys.
    const t = await post("listDates", { location: null });
    assert.equal(t.text, '{"location":null,"dates":[{"date":"2026-11-25"},{"date":"2026-11-26"},{"date":"2026-11-27"}]}');
  });

  await test("new worker body: list-dates count capped 1–10, duration respected", async () => {
    const big = await post("listDates", { location: null, count: 50, after: "2026-11-25" });
    assert.equal((JSON.parse(big.text).dates as unknown[]).length, 10);
    const zero = await post("listDates", { location: null, count: 0, after: "2026-11-25" });
    assert.equal((JSON.parse(zero.text).dates as unknown[]).length, 3, "0 / missing → default 3");
    const neg = await post("listDates", { location: null, count: -4, after: "2026-11-25" });
    assert.equal((JSON.parse(neg.text).dates as unknown[]).length, 1, "negative → 1");
    // A 9-hour service fits no day with an 11:00 booking: nothing within 30 days.
    const long = await post("listDates", { location: null, count: 3, after: "2026-11-25", duration: 540 });
    assert.equal(long.text, '{"location":null,"dates":[],"requested_date":"2026-11-25","requested_date_open":false}');
  });

  await test("new worker body: list-dates bad after: impossible date 400, loose text ignored", async () => {
    const bad = await post("listDates", { location: null, after: "2026-02-30" });
    assert.equal(bad.status, 400);
    assert.equal(bad.text, '{"error":"date invalide : 2026-02-30 (YYYY-MM-DD attendu)"}');
    assert.deepEqual(bad.google, []);
    // A non-YYYY-MM-DD after is ignored (as absent), as before.
    const loose = await post("listDates", { location: null, after: "tomorrow" });
    const none = await post("listDates", { location: null });
    assert.equal(loose.text, none.text);
  });

  // ── Old worker bodies: neutral, exactly the new shape with location null ──
  await test("old worker body: availability with center = new worker body with location null", async () => {
    for (const date of DATES) {
      const expected = await post("availability", { date, duration: 30, location: null });
      for (const center of [...CENTERS, undefined]) {
        const body = { date, duration: 30, ...(center ? { center } : {}) };
        const got = await post("availability", body);
        assert.equal(got.status, 200, `${JSON.stringify(body)} → ${got.text}`);
        assert.equal(got.text, expected.text, JSON.stringify(body));
        assert.deepEqual(got.google, expected.google, JSON.stringify(body));
        const j = JSON.parse(got.text);
        assert.equal(j.location, null);
        assert.ok(!("center" in j) && !("label" in j) && !("suggested_dates" in j) && !("error" in j));
        if (date !== FULL_DAY) assert.ok((j.available_slots as string[]).length > 0, "working slots");
      }
    }
  });

  await test("old worker body: book with center = new worker body with location null (title 'RDV — <name>', no Centre line)", async () => {
    for (const date of DATES.filter((d) => d !== FULL_DAY)) {
      const expected = await post("book", { ...BOOK, date, location: null });
      for (const center of CENTERS) {
        const body = { ...BOOK, date, center };
        const got = await post("book", body);
        assert.equal(got.status, 200, `${JSON.stringify(body)} → ${got.text}`);
        assert.equal(got.text, expected.text, JSON.stringify(body));
        assert.deepEqual(got.google, expected.google, JSON.stringify(body));
        const ins = got.google.find((c) => c.api === "calendar.events.insert")!.args as {
          requestBody: { summary: string; description: string };
        };
        assert.equal(ins.requestBody.summary, "RDV — Mock Client");
        assert.equal(ins.requestBody.description, "Rendez-vous\nTel : +15555550123");
        assert.equal(JSON.parse(got.text).success, true);
      }
    }
  });

  await test("old worker body: reschedule with center = new worker body with location null (title untouched)", async () => {
    for (const date of DATES.filter((d) => d !== FULL_DAY)) {
      const expected = await post("reschedule", { eventId: "evt-1", newDate: date, newTime: "15:00", location: null });
      for (const center of CENTERS) {
        const body = { eventId: "evt-1", newDate: date, newTime: "15:00", center };
        const got = await post("reschedule", body);
        assert.equal(got.status, 200, `${JSON.stringify(body)} → ${got.text}`);
        assert.equal(got.text, expected.text, JSON.stringify(body));
        assert.deepEqual(got.google, expected.google, JSON.stringify(body));
        const patch = got.google.find((c) => c.api === "calendar.events.patch")!.args as { requestBody: Record<string, unknown> };
        assert.ok(!("summary" in patch.requestBody), "no retitle with no place");
      }
    }
  });

  await test("old worker body: list-dates with center (valid, unknown or missing) = new worker body with location null", async () => {
    for (const after of [undefined, "2026-11-23", FULL_DAY, "2026-11-25"]) {
      const expected = await post("listDates", { location: null, count: 3, ...(after ? { after } : {}) });
      for (const center of [...CENTERS, "haifa", "", undefined]) {
        const body = { count: 3, ...(after ? { after } : {}), ...(center !== undefined ? { center } : {}) };
        const got = await post("listDates", body);
        assert.equal(got.status, 200, `${JSON.stringify(body)} → ${got.text}`);
        assert.equal(got.text, expected.text, JSON.stringify(body));
        assert.ok((JSON.parse(got.text).dates as unknown[]).length > 0, "working dates");
      }
    }
  });

  await test("old worker body: no first-customer fact or town in any response, error, title or description", async () => {
    const seen: string[] = [];
    const check = (label: string, o: Outcome, facts: boolean) => {
      for (const t of [o.text, writes(o)]) {
        assert.doesNotMatch(t, TOWNS, `${label}: ${t}`);
        if (facts) assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS, `${label}: ${t}`);
      }
      seen.push(label);
    };
    for (const center of CENTERS) {
      for (const date of DATES) {
        check(`availability ${center} ${date}`, await post("availability", { date, center, duration: 30 }), true);
        // On the full day book / reschedule get the overlap refusal (see below).
        const free = date !== FULL_DAY;
        check(`book ${center} ${date}`, await post("book", { ...BOOK, date, center }), free);
        check(`reschedule ${center} ${date}`, await post("reschedule", { eventId: "evt-1", newDate: date, newTime: "15:00", center }), free);
        check(`list-dates ${center} ${date}`, await post("listDates", { center, count: 3, after: date }), true);
      }
      check(`list-dates ${center} no after`, await post("listDates", { center, count: 10 }), true);
      // Error paths: invalid date, past slot.
      for (const o of [
        await post("availability", { date: "2026-02-30", center, duration: 30 }),
        await post("book", { ...BOOK, date: "2026-02-30", center }),
        await post("book", { ...BOOK, date: "2026-11-01", center }),
        await post("reschedule", { eventId: "evt-1", newDate: "2026-02-30", newTime: "15:00", center }),
        await post("reschedule", { eventId: "evt-1", newDate: "2026-11-01", newTime: "15:00", center }),
        await post("listDates", { center, after: "2026-02-30" }),
      ]) {
        assert.equal(o.status, 400, o.text);
        check(`error ${center}`, o, true);
      }
      // Overlap refusal: its text names the requested duration ("(30 min)"),
      // which the shared list counts as a business fact; towns checked.
      const c = await post("book", { ...BOOK, date: "2026-11-26", time: "11:00", center });
      assert.equal(c.status, 409, c.text);
      check(`conflict ${center}`, c, false);
    }
    assert.ok(seen.length >= 3 * (4 * 4 + 1 + 6 + 1));
  });

  await test("old worker body: the ignored center is logged, without its value", async () => {
    consoleLines.length = 0;
    await post("availability", { date: "2026-11-25", center: "natanya" });
    await post("listDates", { center: "ashdod" });
    assert.ok(consoleLines.some((l) => l.includes("availability: legacy center key ignored")), consoleLines.join("\n"));
    assert.ok(consoleLines.some((l) => l.includes("list-dates: legacy center key ignored")), consoleLines.join("\n"));
    for (const l of consoleLines) assert.doesNotMatch(l, TOWNS);
    consoleLines.length = 0;
    await post("availability", { date: "2026-11-25", location: null });
    assert.ok(!consoleLines.some((l) => l.includes("legacy center")), "new worker body logs nothing");
  });

  console.info = realInfo;
  assert.deepEqual(outbound, [], `outbound requests attempted: ${outbound.join(", ")}`);
  console.log(`\ncalendar-no-first-customer-towns: ${passed} passed`);
}

// Recorded with RECORD=1 on the pre-change routes (origin/main fc1e5e31),
// same fake Google and clock: what the new worker body got before.
const BEFORE: Record<string, Outcome> = {
  "availability location string": {
    "status": 200,
    "text": "{\"date\":\"2026-11-30\",\"location\":\"Mock Studio\",\"available_slots\":[\"09:00\",\"09:30\",\"10:00\",\"11:30\",\"12:00\",\"12:30\",\"13:00\",\"13:30\",\"14:00\",\"14:30\",\"15:00\",\"15:30\",\"16:00\",\"16:30\",\"17:00\"]}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-30T06:00:00.000Z",
          "timeMax": "2026-11-30T18:00:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      }
    ]
  },
  "availability location null": {
    "status": 200,
    "text": "{\"date\":\"2026-11-25\",\"location\":null,\"available_slots\":[\"09:00\",\"09:30\",\"10:00\",\"10:30\",\"11:30\",\"12:00\",\"12:30\",\"13:00\",\"13:30\",\"14:00\",\"14:30\",\"15:00\",\"15:30\",\"16:00\",\"16:30\",\"17:00\",\"17:30\"]}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-25T06:00:00.000Z",
          "timeMax": "2026-11-25T18:00:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      }
    ]
  },
  "availability location null, full day": {
    "status": 200,
    "text": "{\"date\":\"2026-11-24\",\"location\":null,\"available_slots\":[],\"reason\":\"Plus de créneau disponible pour le 2026-11-24.\"}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-24T06:00:00.000Z",
          "timeMax": "2026-11-24T18:00:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      }
    ]
  },
  "book location string": {
    "status": 200,
    "text": "{\"success\":true,\"eventId\":\"evt-new\",\"link\":\"https://calendar.example.test/evt-new\",\"location\":\"Mock Studio\",\"summary\":\"RDV confirmé le 2026-11-30 à 14:00 pour Mock Client à Mock Studio\"}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-30T12:00:00.000Z",
          "timeMax": "2026-11-30T12:30:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      },
      {
        "api": "calendar.events.insert",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "requestBody": {
            "summary": "RDV Mock Studio — Mock Client",
            "description": "Rendez-vous\nLieu : Mock Studio\nTel : +15555550123",
            "start": {
              "dateTime": "2026-11-30T14:00:00",
              "timeZone": "Asia/Jerusalem"
            },
            "end": {
              "dateTime": "2026-11-30T14:30:00",
              "timeZone": "Asia/Jerusalem"
            }
          }
        }
      }
    ]
  },
  "book location null": {
    "status": 200,
    "text": "{\"success\":true,\"eventId\":\"evt-new\",\"link\":\"https://calendar.example.test/evt-new\",\"location\":null,\"summary\":\"RDV confirmé le 2026-11-25 à 14:00 pour Mock Client\"}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-25T12:00:00.000Z",
          "timeMax": "2026-11-25T12:30:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      },
      {
        "api": "calendar.events.insert",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "requestBody": {
            "summary": "RDV — Mock Client",
            "description": "Rendez-vous\nTel : +15555550123",
            "start": {
              "dateTime": "2026-11-25T14:00:00",
              "timeZone": "Asia/Jerusalem"
            },
            "end": {
              "dateTime": "2026-11-25T14:30:00",
              "timeZone": "Asia/Jerusalem"
            }
          }
        }
      }
    ]
  },
  "book location null, conflict": {
    "status": 409,
    "text": "{\"error\":\"slot_conflict\",\"message\":\"Le créneau 11:00 (30 min) chevauche un rendez-vous existant le 2026-11-26. Créneaux libres : 09:00, 09:30, 10:00, 10:30, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00, 17:30.\",\"available_slots\":[\"09:00\",\"09:30\",\"10:00\",\"10:30\",\"11:30\",\"12:00\",\"12:30\",\"13:00\",\"13:30\",\"14:00\",\"14:30\",\"15:00\",\"15:30\",\"16:00\",\"16:30\",\"17:00\",\"17:30\"]}",
    "google": [
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-26T09:00:00.000Z",
          "timeMax": "2026-11-26T09:30:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      },
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-26T06:00:00.000Z",
          "timeMax": "2026-11-26T18:00:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      }
    ]
  },
  "reschedule location string": {
    "status": 200,
    "text": "{\"success\":true,\"eventId\":\"evt-1\",\"location\":\"Mock Studio\",\"summary\":\"RDV déplacé au 2026-11-25 à 15:00 (Mock Studio).\"}",
    "google": [
      {
        "api": "calendar.events.get",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "eventId": "evt-1"
        }
      },
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-25T13:00:00.000Z",
          "timeMax": "2026-11-25T13:30:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      },
      {
        "api": "calendar.events.patch",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "eventId": "evt-1",
          "requestBody": {
            "summary": "RDV Mock Studio — Mock Client",
            "start": {
              "dateTime": "2026-11-25T15:00:00",
              "timeZone": "Asia/Jerusalem"
            },
            "end": {
              "dateTime": "2026-11-25T15:30:00",
              "timeZone": "Asia/Jerusalem"
            }
          }
        }
      }
    ]
  },
  "reschedule location null": {
    "status": 200,
    "text": "{\"success\":true,\"eventId\":\"evt-1\",\"location\":null,\"summary\":\"RDV déplacé au 2026-11-26 à 15:00.\"}",
    "google": [
      {
        "api": "calendar.events.get",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "eventId": "evt-1"
        }
      },
      {
        "api": "calendar.events.list",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "timeMin": "2026-11-26T13:00:00.000Z",
          "timeMax": "2026-11-26T13:30:00.000Z",
          "singleEvents": true,
          "orderBy": "startTime",
          "timeZone": "Asia/Jerusalem"
        }
      },
      {
        "api": "calendar.events.patch",
        "args": {
          "calendarId": "cal-user-worker-mock",
          "eventId": "evt-1",
          "requestBody": {
            "start": {
              "dateTime": "2026-11-26T15:00:00",
              "timeZone": "Asia/Jerusalem"
            },
            "end": {
              "dateTime": "2026-11-26T15:30:00",
              "timeZone": "Asia/Jerusalem"
            }
          }
        }
      }
    ]
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
