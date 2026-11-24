// Anonymous callers (no x-internal-secret, no session) get 401 on every
// agent-facing calendar / sheets route; the worker (internal secret) and a
// signed-in session get exactly what they got before the demo mode was
// removed.
//
// The handlers run for real, outside Next: the session reader and the two DB
// lookups are swapped through lib/google.ts `agentCallerDeps`, the tenant's
// Google clients are in-memory fakes that record every call, and any outbound
// HTTP request (Google included) is blocked and counted. No DB, no network.
//
// Proof that the authorized paths are unchanged: the fixture
// scripts/tests/fixtures/calendar-anon-401.authorized.json was recorded with
// RECORD_FIXTURE=1 on the commit that only adds the injection seam (the
// pre-fix behaviour); this test asserts byte-equal status + body + Google calls
// against it. Re-recorded on fix/calendar-legacy-neutral for the entries
// whose body has no `location` key (availability, list-dates, book,
// reschedule): they pinned the first customer's weekday-to-centre rule
// ("center":"ashdod", "RDV Ashdod — …", "Centre : Ashdod"); they now get the
// neutral answer of `location: null`. Every other entry is unchanged.
//
// Run with:  npx tsx scripts/tests/calendar-anon-401.test.ts
//   (re-record: RECORD_FIXTURE=1 npx tsx scripts/tests/calendar-anon-401.test.ts)

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

import { NextRequest } from "next/server";

const SECRET = "test-internal-secret";
process.env.INTERNAL_SECRET = SECRET;
delete process.env.DATABASE_URL;
// Mock env calendar: the anonymous path must never get to read it.
process.env.GOOGLE_CALENDAR_ID = "env-calendar-mock";
process.env.GOOGLE_SHEET_ID = "env-sheet-mock";

// Frozen clock (2029-12-03 10:00 UTC) so bookings, sheet timestamps and slot
// filtering are deterministic. Test dates are in 2030.
const FIXED = Date.UTC(2029, 11, 3, 10, 0, 0);
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

// Block every outbound request: a hit here means a handler tried to reach
// Google (or anything else) for real.
const outbound: string[] = [];
const block = (mod: typeof http | typeof https, proto: string) => {
  const deny = ((...args: unknown[]) => {
    const a = args[0] as { hostname?: string; host?: string } | string | URL;
    const host = typeof a === "string" ? a : a instanceof URL ? a.host : (a?.hostname ?? a?.host ?? "?");
    outbound.push(`${proto}${host}`);
    throw new Error(`outbound request blocked in test: ${proto}${host}`);
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

type Call = { api: string; args: unknown };

/** In-memory Google clients for one tenant; every call is recorded. */
function fakeGoogle(userId: string, calls: Call[]) {
  const rec = (api: string, data: unknown) => async (args: unknown) => {
    calls.push({ api, args });
    return { data };
  };
  const existing = {
    id: "evt-1",
    summary: "RDV Ashdod — Mock Client",
    description: "Rendez-vous\nTel : +15555550123",
    start: { dateTime: "2030-01-07T11:00:00+02:00" },
    end: { dateTime: "2030-01-07T11:30:00+02:00" },
  };
  const calendar = {
    events: {
      list: rec("calendar.events.list", { items: [existing] }),
      insert: rec("calendar.events.insert", { id: "evt-new", htmlLink: "https://calendar.example.test/evt-new" }),
      get: rec("calendar.events.get", existing),
      patch: rec("calendar.events.patch", { ...existing, id: "evt-1" }),
      delete: rec("calendar.events.delete", {}),
    },
  };
  const sheets = {
    spreadsheets: {
      get: rec("sheets.spreadsheets.get", {
        sheets: [
          { properties: { title: "Clients", sheetId: 11 } },
          { properties: { title: "Appels", sheetId: 12 } },
        ],
      }),
      batchUpdate: rec("sheets.spreadsheets.batchUpdate", { replies: [] }),
      values: {
        get: rec("sheets.spreadsheets.values.get", {
          values: [["Nom", "Téléphone"], ["Mock Client", "'+15555550123", "", "first", "01/12/2029", "01/12/2029"]],
        }),
        update: rec("sheets.spreadsheets.values.update", {}),
        append: rec("sheets.spreadsheets.values.append", {}),
      },
    },
  };
  return { calendar, sheets, calendarId: `cal-${userId}`, sheetId: `sheet-${userId}` };
}

const WORKER_PHONE = "+15555550100";
const WORKER_USER = "user-worker-mock";
const SESSION_USER = "user-session-mock";

type Caller = "worker" | "session" | "anonymous";

const DATE = "2030-01-07"; // a Monday (legacy rule: Ashdod)
const ROUTES: { route: string; mod: string; body: Record<string, unknown> }[] = [
  { route: "calendar/availability", mod: "../../app/api/calendar/availability/route", body: { date: DATE, duration: 30 } },
  { route: "calendar/availability (location)", mod: "../../app/api/calendar/availability/route", body: { date: DATE, duration: 60, location: "Mock Studio" } },
  { route: "calendar/list-dates", mod: "../../app/api/calendar/list-dates/route", body: { center: "ashdod", count: 2, after: DATE } },
  { route: "calendar/book", mod: "../../app/api/calendar/book/route", body: { name: "Mock Client", phone: "+15555550123", date: DATE, time: "14:00", duration: 30 } },
  { route: "calendar/book (conflict)", mod: "../../app/api/calendar/book/route", body: { name: "Mock Client", phone: "+15555550123", date: DATE, time: "11:00", duration: 30 } },
  { route: "calendar/find", mod: "../../app/api/calendar/find/route", body: { phone: "+15555550123" } },
  { route: "calendar/cancel", mod: "../../app/api/calendar/cancel/route", body: { eventId: "evt-1" } },
  { route: "calendar/reschedule", mod: "../../app/api/calendar/reschedule/route", body: { eventId: "evt-1", newDate: DATE, newTime: "15:00" } },
  { route: "sheets/contact", mod: "../../app/api/sheets/contact/route", body: { name: "Mock Client", phone: "+15555550123", notes: "second" } },
  { route: "sheets/call-log", mod: "../../app/api/sheets/call-log/route", body: { fromNumber: "+15555550123", callerName: "Mock Client", durationSeconds: 75, type: "info", summary: "mock" } },
];

function headersFor(caller: Caller): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (caller === "worker") {
    h["x-internal-secret"] = SECRET;
    h["x-tenant-phone"] = WORKER_PHONE;
  }
  return h;
}

type Outcome = { status: number; body: unknown; google: Call[] };

async function main() {
  const google = await import("../../lib/google");
  const deps = google.agentCallerDeps as unknown as Record<string, unknown>;

  let sessionUser: string | null = null;
  let calls: Call[] = [];
  deps.auth = async () => (sessionUser ? { user: { id: sessionUser }, expires: "2099-01-01T00:00:00.000Z" } : null);
  deps.resolveTenantByPhone = async (phone: string) => (phone === WORKER_PHONE ? { user: { id: WORKER_USER } } : null);
  deps.getTenantGoogleClients = async (userId: string) =>
    userId === WORKER_USER || userId === SESSION_USER ? fakeGoogle(userId, calls) : null;

  async function run(r: (typeof ROUTES)[number], caller: Caller): Promise<Outcome> {
    sessionUser = caller === "session" ? SESSION_USER : null;
    calls = [];
    const { POST } = await import(r.mod);
    const res: Response = await POST(
      new NextRequest(`https://example.test/api/${r.route.split(" ")[0]}`, {
        method: "POST",
        headers: headersFor(caller),
        body: JSON.stringify(r.body),
      }),
    );
    return { status: res.status, body: await res.json(), google: calls };
  }

  const authorized: Record<string, Outcome> = {};
  const anonymous: Record<string, Outcome> = {};
  for (const r of ROUTES) {
    authorized[`${r.route} :: worker`] = await run(r, "worker");
    authorized[`${r.route} :: session`] = await run(r, "session");
    anonymous[r.route] = await run(r, "anonymous");
  }

  const fixturePath = path.join(__dirname, "fixtures", "calendar-anon-401.authorized.json");
  if (process.env.RECORD_FIXTURE === "1") {
    writeFileSync(fixturePath, JSON.stringify(authorized, null, 2) + "\n");
    console.log(`recorded ${fixturePath}`);
    console.log("anonymous (as recorded):");
    for (const [k, v] of Object.entries(anonymous)) console.log(`  ${k}: ${v.status} ${JSON.stringify(v.body).slice(0, 120)}`);
    console.log(`outbound attempts: ${JSON.stringify(outbound)}`);
    return;
  }

  // (a) + (b): worker and signed-in session, same status, body and Google
  // calls as before the fix, on every route.
  assert.ok(existsSync(fixturePath), "fixture missing: record it on the seam-only commit");
  const before = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, Outcome>;
  assert.deepEqual(Object.keys(authorized).sort(), Object.keys(before).sort());
  for (const [k, v] of Object.entries(authorized)) {
    assert.deepEqual(JSON.parse(JSON.stringify(v)), before[k], `authorized path changed: ${k}`);
  }
  // sanity: the fixture really exercised the tenant clients
  assert.equal(authorized["calendar/book :: worker"].status, 200);
  assert.equal(authorized["calendar/book :: session"].status, 200);
  assert.ok(authorized["calendar/availability :: session"].google.length > 0);
  assert.ok(authorized["sheets/contact :: worker"].google.length > 0);

  // (c) anonymous: 401 on every route, no Google call, nothing simulated.
  for (const [k, v] of Object.entries(anonymous)) {
    assert.equal(v.status, 401, `anonymous ${k} must be 401, got ${v.status} ${JSON.stringify(v.body)}`);
    assert.equal(v.google.length, 0, `anonymous ${k} reached the Google clients`);
    assert.equal((v.body as { error?: string }).error, "unauthorized", `anonymous ${k}`);
  }
  // anonymous with an invalid body is refused before any validation
  for (const r of ROUTES) {
    sessionUser = null;
    const { POST } = await import(r.mod);
    const res: Response = await POST(
      new NextRequest(`https://example.test/api/${r.route.split(" ")[0]}`, { method: "POST", body: "{}" }),
    );
    assert.equal(res.status, 401, `anonymous empty body on ${r.route}`);
  }
  // a wrong secret with no session is anonymous too
  {
    const { POST } = await import("../../app/api/calendar/availability/route");
    const res: Response = await POST(
      new NextRequest("https://example.test/api/calendar/availability", {
        method: "POST",
        headers: { "x-internal-secret": "wrong", "x-tenant-phone": WORKER_PHONE },
        body: JSON.stringify({ date: DATE }),
      }),
    );
    assert.equal(res.status, 401);
  }

  // the resolver itself has no demo mode left
  sessionUser = null;
  const r = await google.resolveAgentCallerGoogle({ headers: new Headers() });
  assert.equal(r.mode, "anonymous");
  assert.equal("calendar" in r, false, "the anonymous result carries no Google client");

  // smoke-prod.ts: anonymous find/cancel → 401 (unchanged)
  assert.equal(anonymous["calendar/find"].status, 401);
  assert.equal(anonymous["calendar/cancel"].status, 401);

  assert.deepEqual(outbound, [], `outbound requests attempted: ${outbound.join(", ")}`);
  console.log("ALL CALENDAR-ANON-401 TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
