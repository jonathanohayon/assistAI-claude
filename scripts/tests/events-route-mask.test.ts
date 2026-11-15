// GET /api/dashboard/events masks every row SERVER-SIDE before the JSON leaves:
// no caller number, email or `*Hash` in the response a tenant can read in
// devtools, for rows stored before #332 and after. Read-time only. The route's
// own pipeline (eventsForViewer -> eventRowsForBrowser) is run on mock rows,
// the Monitoring screen's real grouping is run on the result, and a static
// guard proves the route (and the admin campaign console) use the mask.
// Mock numbers only (+1555, example.com).
// Run with:  npx tsx scripts/tests/events-route-mask.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { groupEventsByCall, type EventRow } from "../../app/[locale]/dashboard/logs/logs-view";
import { callReceivedEvent } from "../../lib/call-received-event";
import { eventsForViewer } from "../../lib/engine-visibility";
import { eventRowForBrowser, eventRowsForBrowser } from "../../lib/event-display";
import { eventForStorage } from "../../lib/event-pii";
import { PHONE_RE } from "../../lib/pii-mask";

const ROOT = new URL("../../", import.meta.url).pathname;
const TENANT_LINE = "+15550100999";
const CALLER = "+15550100123";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

type Row = EventRow & { userId: string };
let n = 0;
const row = (event: string, metadata: Record<string, unknown> | null, message = "", level: Row["level"] = "info"): Row => ({
  id: `e${++n}`,
  userId: "u1",
  level,
  source: "agent",
  event,
  message,
  metadata,
  createdAt: new Date(Date.UTC(2026, 10, 15, 10, 0, n)).toISOString(),
});

/** What the route sends: the same two steps, in the same order. */
const response = (rows: Row[], isAdmin = false) =>
  JSON.parse(JSON.stringify({ events: eventRowsForBrowser(eventsForViewer(rows, isAdmin)) })) as { events: Row[] };

/** The JSON with the tenant's own line removed: whatever phone number is left is a leak. */
function assertNoPii(json: string, label: string) {
  const rest = json.split(TENANT_LINE).join("");
  assert.ok(!new RegExp(PHONE_RE.source).test(rest), `${label}: no phone number besides the tenant line: ${json}`);
  assert.ok(!EMAIL.test(json), `${label}: no email: ${json}`);
  assert.ok(!/Hash"/.test(json), `${label}: no *Hash key: ${json}`);
  assert.ok(!json.includes("0100123") && !json.includes("010 0123"), `${label}: no caller digits beyond the last 4`);
}

// An event stored BEFORE #332: caller number in clear, number + email in the message.
const OLD_STARTED = row("call_started", {
  roomName: `call-${CALLER}`,
  origin: { kind: "sip", calledNumber: TENANT_LINE, channel: "pstn" },
});
const OLD_RECEIVED = row(
  "call_received",
  { fromNumber: CALLER, toNumber: TENANT_LINE, callId: "c-old", nested: { callerPhone: CALLER, ownerEmail: "ana@example.com" } },
  `Appel reçu de +1 555 010 0123 — récap à ana@example.com`,
);
// An event stored since #332 (fromHash + fromLast4, no number).
const NEW_STARTED = row("call_started", { roomName: "room-new", origin: { kind: "sip", calledNumber: TENANT_LINE, channel: "pstn" } });
const NEW_RECEIVED = row(
  "call_received",
  eventForStorage(callReceivedEvent({ fromNumber: CALLER, toNumber: TENANT_LINE, callId: "c-new", transcriptEntries: 3 })).metadata,
  "Appel reçu",
);

// 1. Old-shape row → no caller number, no email, no *Hash in the JSON
{
  for (const isAdmin of [false, true]) {
    const out = response([OLD_STARTED, OLD_RECEIVED], isAdmin);
    assertNoPii(JSON.stringify(out), `old row (admin=${isAdmin})`);
    const r = out.events.find((e) => e.event === "call_received")!;
    assert.equal(r.message, "Appel reçu de …0123 — récap à [email]");
    assert.equal(r.metadata!["fromNumber"], "…0123");
    assert.equal(r.metadata!["toNumber"], TENANT_LINE, "the tenant's own line is kept");
    const s = out.events.find((e) => e.event === "call_started")!;
    assert.equal((s.metadata!["origin"] as { calledNumber: string }).calledNumber, TENANT_LINE);
  }
}

// 2. New-shape row → no *Hash, fromLast4 and toNumber kept
{
  assert.ok(NEW_RECEIVED.metadata!["fromHash"], "fixture carries a fromHash");
  const out = response([NEW_STARTED, NEW_RECEIVED]);
  assertNoPii(JSON.stringify(out), "new row");
  const r = out.events.find((e) => e.event === "call_received")!;
  assert.equal(r.metadata!["fromHash"], undefined);
  assert.equal(r.metadata!["fromLast4"], "0123");
  assert.equal(r.metadata!["toNumber"], TENANT_LINE);
  assert.equal(r.metadata!["callId"], "c-new");
  assert.equal(r.metadata!["transcriptEntries"], 3);
}

// 3. Monitoring's grouping and SIP label still work on the masked response
{
  for (const [label, rows] of [
    ["old", [OLD_STARTED, OLD_RECEIVED]],
    ["new", [NEW_STARTED, NEW_RECEIVED]],
  ] as const) {
    const calls = groupEventsByCall(response([...rows]).events, null).filter((g) => g.kind === "call");
    assert.equal(calls.length, 1, `${label}: one call group`);
    assert.equal(calls[0].origin, "sip");
    assert.equal(calls[0].events.length, 2);
    assert.deepEqual(calls[0].sip, { last4: "0123", to: "+1 555-010-0999" }, `${label}: SIP label`);
  }
  // Web sessions and usage figures are untouched.
  const web = row("call_started", { roomName: "livetest-1", origin: { kind: "web", userId: "u1" } });
  const metrics = row("call_metrics", { usage: { totalTokens: 1200, costUsd: 0.04 } });
  const [g] = groupEventsByCall(response([web, metrics]).events, null);
  assert.equal(g.origin, "web");
  assert.equal(g.label, "Web LiveTest");
  assert.equal(g.totalTokens, 1200);
  assert.equal(g.costUsd, 0.04);
}

// 4. Every other field unchanged (id, createdAt, event, level, source, userId)
{
  const rows = [OLD_STARTED, OLD_RECEIVED, NEW_RECEIVED, row("tool_error", null, "Échec", "error")];
  const out = response(rows, true).events;
  assert.equal(out.length, rows.length);
  out.forEach((e, i) => {
    const { message: _m, metadata: _md, ...rest } = e;
    const { message: _om, metadata: _omd, ...orig } = rows[i];
    void _m, _md, _om, _omd;
    assert.deepEqual(rest, orig);
  });
  assert.equal(out[3].metadata, null, "null metadata stays null");
  // Idempotent: the screen applies the same mask again with no change.
  const once = eventRowForBrowser(OLD_RECEIVED);
  assert.deepEqual(eventRowForBrowser(once), once);
  // Nothing is written: the source rows are not mutated.
  assert.equal(OLD_RECEIVED.metadata!["fromNumber"], CALLER);
}

// 5. Static guard: the routes that hand event rows to a browser use the mask
{
  const src = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\/\/.*$/gm, "");
  const events = src("app/api/dashboard/events/route.ts");
  assert.match(events, /from "@\/lib\/event-display"/);
  assert.match(events, /events:\s*eventRowsForBrowser\(eventsForViewer\(/, "events route masks after the engine filter");
  const live = src("app/api/dashboard/campaigns/[id]/live/route.ts");
  assert.match(live, /eventRowForBrowser\(e\)/);
  assert.match(live, /message:\s*masked\.message/);
  assert.match(live, /data:\s*masked\.metadata/);
  assert.ok(!/message:\s*e\.message|data:\s*e\.metadata/.test(live), "live console never sends the raw message/metadata");
  // The mask is not redefined: event-display builds on monitoring-label.
  const display = src("lib/event-display.ts");
  assert.match(display, /from "@\/lib\/monitoring-label"/);
  assert.ok(!/RegExp|replace\(/.test(display), "no second definition of the masks");
}

console.log("events-route-mask: OK");
