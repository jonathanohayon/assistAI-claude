// Tenant Calls page — pure helpers (lib/calls/core.ts) + source-level guards
// of the routes. Mock data only (+1555 numbers). The real-Postgres part is
// scripts/tests/calls-routes-db.test.ts.
// Run with:  npx tsx scripts/tests/calls-routes.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  attachEvents,
  callKeys,
  decodeCursor,
  durationOrNull,
  encodeCursor,
  figuresFor,
  hashCallId,
  outcomeFromEvents,
  parseLimit,
  parsePeriod,
  readTranscript,
  textDirection,
  toActions,
  toLine,
  type JoinCall,
  type JoinEvent,
} from "../../lib/calls/core";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const T0 = new Date("2026-11-01T10:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
let n = 0;
const ev = (event: string, sec: number, metadata: Record<string, unknown> = {}, userId: string | null = A): JoinEvent => ({
  id: `e${++n}`,
  userId,
  event,
  createdAt: at(sec),
  metadata,
});
const call = (id: string, callId: string, endSec: number, dur: number, userId = A): JoinCall => ({
  id,
  userId,
  callId,
  createdAt: at(endSec),
  durationSeconds: dur,
});

// ── Outcome: facts from tool events only ────────────────────────────────
{
  assert.equal(outcomeFromEvents([]), "conversation");
  assert.equal(outcomeFromEvents([ev("book_success", 0)]), "booked");
  assert.equal(outcomeFromEvents([ev("cancel_success", 0)]), "cancelled");
  assert.equal(outcomeFromEvents([ev("reschedule_success", 0)]), "rescheduled");
  assert.equal(outcomeFromEvents([ev("call_transfer", 0, { ok: true })]), "transferred");
  assert.equal(outcomeFromEvents([ev("call_transfer", 0, { ok: false })]), "conversation", "failed transfer is not a transfer");
  assert.equal(outcomeFromEvents([ev("call_transfer", 0, { ok: "true" })]), "conversation", "ok must be boolean true");
  // Precedence: cancelled > rescheduled > booked > transferred
  assert.equal(outcomeFromEvents([ev("book_success", 0), ev("cancel_success", 1)]), "cancelled");
  assert.equal(outcomeFromEvents([ev("book_success", 0), ev("reschedule_success", 1)]), "rescheduled");
  assert.equal(outcomeFromEvents([ev("call_transfer", 0, { ok: true }), ev("book_success", 1)]), "booked");
  assert.equal(outcomeFromEvents([ev("whatsapp_sent_client", 0), ev("summary_generated", 0)]), "conversation");
}

// No keyword guess: a summary full of booking words, no tool event → conversation.
{
  const line = toLine(
    {
      id: "c1",
      createdAt: T0,
      fromNumber: "+15550000001",
      summary: "La cliente veut un rendez-vous, RDV pris mardi, appointment booked, annuler",
      transcript: [{ role: "user", text: "Je voudrais un rendez-vous" }],
      durationSeconds: 42,
    },
    [],
    null,
  );
  assert.equal(line.outcome, "conversation", "no keyword guess");
}

// ── Duration: never 0 ───────────────────────────────────────────────────
assert.equal(durationOrNull(0), null);
assert.equal(durationOrNull(undefined), null);
assert.equal(durationOrNull(null), null);
assert.equal(durationOrNull(-3), null);
assert.equal(durationOrNull(61), 61);

// ── THE JOIN TRAP ───────────────────────────────────────────────────────
{
  const ROOM = "call-_+15550000001_abc"; // raw room name (old worker)
  const HASH = hashCallId("call-_+15550000002_def"); // hashed id (worker since 2026-11-05)
  assert.match(HASH, /^[0-9a-f]{16}$/);
  assert.equal(hashCallId("x"), "2d711642b726b044", "same as the worker: sha256 hex, first 16");

  const rawCall = call("11111111-1111-4111-8111-111111111111", ROOM, 100, 60);
  const hashCall = call("22222222-2222-4222-8222-222222222222", HASH, 100, 60);
  const legacy = call("33333333-3333-4333-8333-333333333333", "", 500, 60);
  const legacy2 = call("44444444-4444-4444-8444-444444444444", "", 520, 60); // overlaps legacy
  const rawWithHashedEvents = call("55555555-5555-4555-8555-555555555555", "call-_+15550000005_ghi", 900, 60);

  assert.deepEqual(callKeys(legacy), [legacy.id], "no call id → only the uuid");
  assert.deepEqual(callKeys(rawCall), [rawCall.id, ROOM, hashCallId(ROOM)]);

  const events: JoinEvent[] = [
    ev("book_success", 80, { callId: ROOM, date: "2026-11-03", time: "10:00" }), // → rawCall
    ev("call_transfer", 90, { callId: HASH, ok: true }), // → hashCall
    ev("whatsapp_sent_client", 105, { callId: rawCall.id, sid: "SM1" }), // post-call, uuid → rawCall
    ev("call_received", 101, { callId: hashCall.id }), // post-call, uuid → hashCall
    ev("cancel_success", 470, {}), // unstamped, in legacy's window only → legacy
    ev("book_success", 495, {}), // unstamped, in both legacy windows → earliest ending (legacy)
    ev("reschedule_success", 515, {}), // unstamped, only in legacy2's window
    ev("book_success", 480, { callId: "some-other-call" }), // stamped with ANOTHER call: never a legacy match
    ev("book_success", 480, {}, B), // ANOTHER tenant in the same window
    ev("book_success", 85, { callId: ROOM }, B), // another tenant, same id
    ev("book_success", 3000, {}), // unstamped, outside every window
    ev("book_success", 80, {}), // unstamped in rawCall's span: a call with an id never takes unstamped events
    ev("book_success", 880, { callId: hashCallId("call-_+15550000005_ghi") }), // raw row, hashed event
  ];
  const m = attachEvents([rawCall, hashCall, legacy, legacy2, rawWithHashedEvents], events);
  const names = (id: string) => m.get(id)!.map((e) => e.event);

  assert.deepEqual(names(rawCall.id), ["book_success", "whatsapp_sent_client"], "raw room name + uuid post-call");
  assert.deepEqual(names(hashCall.id), ["call_transfer", "call_received"], "hashed id + uuid post-call");
  assert.deepEqual(names(legacy.id), ["cancel_success", "book_success"], "'' row: time window, earliest ending");
  assert.deepEqual(names(legacy2.id), ["reschedule_success"]);
  assert.deepEqual(names(rawWithHashedEvents.id), ["book_success"], "raw row matches the hash of its room");
  const attached = new Set([...m.values()].flat().map((e) => e.id));
  for (const e of events) {
    if (e.userId === B) assert.ok(!attached.has(e.id), "another tenant's event never attached");
    if (e.metadata?.callId === "some-other-call") assert.ok(!attached.has(e.id), "another call's event never attached");
  }
  assert.equal(attached.size, 8);

  assert.equal(outcomeFromEvents(m.get(legacy.id)!), "cancelled");
  assert.equal(outcomeFromEvents(m.get(hashCall.id)!), "transferred");

  // A call of tenant B never takes tenant A events, even by exact id.
  const bCall = call("66666666-6666-4666-8666-666666666666", ROOM, 100, 60, B);
  const mb = attachEvents([bCall], [ev("book_success", 80, { callId: ROOM })]);
  assert.equal(mb.get(bCall.id)!.length, 0);

  // Figures: tool-proven, each call once.
  const f = figuresFor([rawCall.id, hashCall.id, legacy.id, legacy2.id], m);
  assert.deepEqual(f, { callsReceived: 4, booked: 2, transferred: 1 });
  const twice = attachEvents([hashCall], [ev("book_success", 60, { callId: HASH }), ev("book_success", 70, { callId: HASH })]);
  assert.deepEqual(figuresFor([hashCall.id], twice), { callsReceived: 1, booked: 1, transferred: 0 });
  const noTool = attachEvents([hashCall], [ev("whatsapp_sent_owner", 120, { callId: hashCall.id })]);
  assert.deepEqual(figuresFor([hashCall.id], noTool), { callsReceived: 1, booked: 0, transferred: 0 });
}

// ── Actions: plain facts, whitelisted fields only ───────────────────────
{
  const acts = toActions([
    ev("book_success", 1, { callId: "x", eventId: "gcal-1", name: "Mock Client", phone: "+15550000001", date: "2026-11-03", time: "10:00" }),
    ev("reschedule_success", 2, { newDate: "2026-11-04", newTime: "bad" }),
    ev("cancel_success", 3, { eventId: "gcal-1" }),
    ev("call_transfer", 4, { ok: false, error: "secret detail", reason: "caller asked" }),
    ev("whatsapp_sent_client", 5, { sid: "SM1", to: "+15550000001" }),
    ev("whatsapp_sent_owner", 6, { sid: "SM2", to: "+15550000009" }),
    ev("whatsapp_undelivered_owner", 14, { sid: "SM2", errorCode: 63016 }),
    ev("whatsapp_failed_client", 7, { error: "boom" }),
    ev("summary_generated", 8, {}),
  ]);
  assert.deepEqual(acts, [
    { at: at(1).toISOString(), kind: "booked", date: "2026-11-03", time: "10:00" },
    { at: at(2).toISOString(), kind: "rescheduled", date: "2026-11-04", time: null },
    { at: at(3).toISOString(), kind: "cancelled" },
    { at: at(4).toISOString(), kind: "transferred", ok: false },
    { at: at(5).toISOString(), kind: "whatsapp_recap", recipient: "caller", status: "sent" },
    { at: at(6).toISOString(), kind: "whatsapp_recap", recipient: "owner", status: "undelivered" },
    { at: at(7).toISOString(), kind: "whatsapp_recap", recipient: "caller", status: "failed" },
  ]);
  const json = JSON.stringify(acts);
  for (const leak of ["gcal-1", "Mock Client", "+1555", "SM1", "secret", "callId", "63016"]) {
    assert.ok(!json.includes(leak), `actions never leak ${leak}`);
  }
}

// ── Transcript shapes ───────────────────────────────────────────────────
{
  assert.deepEqual(
    readTranscript([
      { role: "assistant", text: "Bonjour" },
      { role: "user", text: "  " },
      { role: "user", text: "Je voudrais un RDV" },
    ]),
    { turns: [{ role: "agent", text: "Bonjour" }, { role: "caller", text: "Je voudrais un RDV" }], raw: null },
  );
  assert.deepEqual(readTranscript([]), { turns: [], raw: null });
  assert.deepEqual(readTranscript({ text: "odd" }), { turns: [], raw: '{"text":"odd"}' });
  assert.deepEqual(readTranscript([{ role: "system", text: "x" }]), { turns: [], raw: '[{"role":"system","text":"x"}]' });
  assert.deepEqual(readTranscript(null), { turns: [], raw: null });
}

// ── Direction ───────────────────────────────────────────────────────────
assert.equal(textDirection(["שלום, אני רוצה לקבוע תור"]), "rtl");
assert.equal(textDirection(["Bonjour, je voudrais un rendez-vous"]), "ltr");
assert.equal(textDirection([]), "ltr");
assert.equal(textDirection(["12:30 +1555"]), "ltr", "no letters → ltr");
assert.equal(textDirection(["שלום שלום", "ok"]), "rtl", "Hebrew majority");
assert.equal(textDirection(["שלום", "Bonjour madame comment allez-vous"]), "ltr", "Latin majority");

// ── Line flags ──────────────────────────────────────────────────────────
{
  const l = toLine(
    { id: "c2", createdAt: T0, fromNumber: "", summary: "  ", transcript: [{ role: "user", text: "" }], durationSeconds: 0 },
    [],
    "  ",
  );
  assert.deepEqual(
    { hasSummary: l.hasSummary, hasTranscript: l.hasTranscript, durationSeconds: l.durationSeconds, contactName: l.contactName },
    { hasSummary: false, hasTranscript: false, durationSeconds: null, contactName: null },
  );
}

// ── Period, limit, cursor ───────────────────────────────────────────────
{
  const now = new Date("2026-11-11T12:00:00.000Z");
  const p = parsePeriod(null, null, now)!;
  assert.equal(p.until.toISOString(), now.toISOString());
  assert.equal(p.since.toISOString(), "2026-10-12T12:00:00.000Z", "default: last 30 days");
  assert.equal(parsePeriod("2026-11-10", "2026-11-01"), null, "since after until");
  assert.equal(parsePeriod("garbage", null), null);
  assert.equal(parsePeriod("2024-01-01", "2026-01-01"), null, "more than 366 days");
  assert.ok(parsePeriod("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"));
  assert.equal(parseLimit(null), 50);
  assert.equal(parseLimit("500"), 100);
  assert.equal(parseLimit("0"), 50);
  assert.equal(parseLimit("abc"), 50);
  assert.equal(parseLimit("20"), 20);

  const c = { period: p, createdAt: "2026-11-01T10:00:00.123456Z", id: A };
  const enc = encodeCursor(c);
  assert.deepEqual(decodeCursor(enc), c, "cursor round-trips with microseconds and the period");
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor(Buffer.from("a|b|c|d").toString("base64url")), null);
  assert.equal(
    decodeCursor(Buffer.from(`${p.since.toISOString()}|${p.until.toISOString()}|2026-11-01T10:00:00.123Z|${A}`).toString("base64url")),
    null,
    "millisecond timestamps are refused (would break keyset stability)",
  );
}

// ── Source-level guards ─────────────────────────────────────────────────
{
  const root = path.resolve(new URL("../..", import.meta.url).pathname);
  const ROUTES = ["app/api/dashboard/calls/route.ts", "app/api/dashboard/calls/[id]/route.ts"];
  // The shared session guard (every dashboard route uses it) is the only
  // module not walked: the routes take nothing else from it (checked below).
  const SHARED_AUTH = path.join(root, "lib/api/auth-guards.ts");
  const seen = new Set<string>();
  const pkgs = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else {
      pkgs.add(spec);
      return null;
    }
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };
  const walk = (f: string) => {
    if (seen.has(f) || f === SHARED_AUTH) return;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolve(f, m[1] ?? m[2]);
      if (r) walk(r);
    }
  };
  for (const r of ROUTES) walk(path.join(root, r));
  const files = [...seen].map((f) => path.relative(root, f));
  for (const must of ["lib/calls/query.ts", "lib/calls/core.ts", "lib/calls/contract.ts", "lib/call-type.ts", "lib/db/index.ts"]) {
    assert.ok(files.includes(must), `closure walked ${must}`);
  }
  for (const f of files) {
    assert.doesNotMatch(f, /summar|analy[sz]|openai|whatsapp|google|sheets|logger|email|alerts/i, `routes never reach ${f}`);
    const src = readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f}: no fetch`);
  }
  for (const p of pkgs) assert.doesNotMatch(p, /openai|resend|googleapis|twilio|livekit/i, `no network package ${p}`);

  for (const r of ROUTES) {
    const src = readFileSync(path.join(root, r), "utf8");
    assert.match(src, /import \{ resolveTargetUserId \} from "@\/lib\/api\/auth-guards";/, `${r}: only the scope helper`);
    assert.match(src, /await resolveTargetUserId\(req\)/, `${r}: scoped`);
    assert.doesNotMatch(src, /export async function (POST|PUT|PATCH|DELETE)/, `${r}: GET only`);
  }
  const detail = readFileSync(path.join(root, ROUTES[1]), "utf8");
  assert.match(detail, /if \(!call\) return NextResponse\.json\(\{ error: "not_found" \}, \{ status: 404 \}\)/);

  // No write: lib/calls reads only.
  for (const f of ["lib/calls/query.ts", "lib/calls/core.ts"]) {
    const src = readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /\bdb\s*\.\s*(insert|update|delete)\b|\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i, `${f}: read-only`);
  }
  // Outcome never reads calls.call_type (it mixes keyword guesses).
  for (const f of ["lib/calls/query.ts", "lib/calls/core.ts"]) {
    const src = readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /call_type|callType\b|inferCallType|resolveCallType/, `${f}: no call_type / keywords`);
  }
}

console.log("ALL CALLS-ROUTES TESTS PASSED");
