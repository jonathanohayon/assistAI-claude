// J-1 reminder caps (lib/appointment-reminders-run.ts). Every side effect is
// faked: no Google, no Twilio, no database. Part 1 (always) uses the pure
// limiter decision in memory; Part 2 (only with REMINDERS_CAP_DB_TEST_URL, a
// THROWAWAY local Postgres — see scripts/appointment-reminders-cap-db.sh)
// runs the same tenant loop against the real shared limiter.
// Run with:  npx tsx scripts/tests/appointment-reminders-cap.test.ts

import assert from "node:assert/strict";

import {
  REMINDERS_CAP_WINDOW_MS,
  REMINDERS_GLOBAL_PER_DAY,
  REMINDERS_PER_TENANT_PER_DAY,
  REMINDERS_RATE_BUCKET,
  type ReminderCalendarEvent,
  type ReminderDeps,
  type ReminderLogEvent,
  remindTenant,
} from "../../lib/appointment-reminders-run";
import { decideRateLimit, type RateLimitLedger, type RateLimitResult } from "../../lib/rate-limit-db-core";
import { formatDateLabel, parseEventContact, reminderText } from "../../lib/reminders";
import { JERUSALEM_TZ } from "../../lib/tz";
import { withCallUsLine } from "../../lib/whatsapp-call-line";

for (const k of Object.keys(process.env)) if (k.startsWith("TWILIO") || k.startsWith("WHATSAPP")) delete process.env[k];

const TOMORROW = "2030-01-15";
const TENANT_A = { id: "00000000-0000-4000-8000-00000000000a", primaryLanguage: "en" };
const TENANT_B = { id: "00000000-0000-4000-8000-00000000000b", primaryLanguage: "fr" };
const CALL_NUMBER = "+15550001000";

/** Mock event i: one distinct +1555 number per index, 08:00 + i minutes. */
function mockEvent(i: number, phoneIndex = i): ReminderCalendarEvent {
  const start = new Date(Date.UTC(2030, 0, 15, 6, 0) + i * 60_000).toISOString();
  return {
    id: `evt-${String(i).padStart(4, "0")}`,
    summary: `RDV Test — Client ${i}`,
    description: `Centre : Test centre\nTel : +1555${String(1_000_000 + phoneIndex).slice(1)}`,
    start: { dateTime: start },
  };
}

type Sent = { to: string; body: string };

/** Fake deps; `limiter` is shared between tenants to model the global ceiling. */
function fakeDeps(
  tenantId: string,
  events: ReminderCalendarEvent[],
  limiter: (accountId: string) => Promise<RateLimitResult>,
  opts: { stored?: Array<{ eventId: string; clientPhone: string; status: string }>; failTo?: Set<string> } = {},
) {
  const sends: Sent[] = [];
  const recorded: string[] = [];
  const logs: ReminderLogEvent[] = [];
  const deps: ReminderDeps = {
    listEvents: async () => events,
    alreadyReminded: async (ids) => (opts.stored ?? []).filter((r) => ids.includes(r.eventId)),
    callNumber: async () => CALL_NUMBER,
    consume: () => limiter(tenantId),
    send: async ({ to, body }) => {
      sends.push({ to, body });
      return opts.failTo?.has(to) ? { ok: false, error: "mock failure" } : { ok: true, sid: `SM${sends.length}` };
    },
    record: async (row) => {
      recorded.push(row.eventId);
    },
    log: async (ev) => {
      logs.push(ev);
    },
  };
  return { deps, sends, recorded, logs };
}

function memoryLimiter(rule = { windowMs: REMINDERS_CAP_WINDOW_MS, perAccount: REMINDERS_PER_TENANT_PER_DAY, global: REMINDERS_GLOBAL_PER_DAY }) {
  let ledger: RateLimitLedger = {};
  let now = 1_000_000;
  return async (accountId: string): Promise<RateLimitResult> => {
    const d = decideRateLimit(ledger, accountId, now++, rule);
    ledger = d.next;
    return d.result;
  };
}

/** main's per-event logic before the cap (reference for "same sends, same order"). */
function mainLogicSends(lang: "fr" | "he" | "en", events: ReminderCalendarEvent[], already: Set<string>): Sent[] {
  const out: Sent[] = [];
  for (const ev of events.filter((e) => e.id && e.start?.dateTime)) {
    if (already.has(ev.id as string)) continue;
    const { name, phone, center } = parseEventContact({ summary: ev.summary, description: ev.description });
    if (!phone) continue;
    const startISO = ev.start?.dateTime ?? null;
    const time = startISO
      ? new Intl.DateTimeFormat("fr-FR", { timeZone: JERUSALEM_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(startISO))
      : "";
    const text = withCallUsLine(reminderText(lang, { name, dateLabel: formatDateLabel(TOMORROW, lang), time, center }), lang, CALL_NUMBER);
    out.push({ to: phone, body: text });
  }
  return out;
}

const capped = (logs: ReminderLogEvent[]) => logs.filter((l) => l.event === "reminders_capped");

async function part1() {
  assert.match(REMINDERS_RATE_BUCKET, /^[a-z0-9_]{1,64}$/);
  assert.equal(REMINDERS_PER_TENANT_PER_DAY, 100);

  // Under the cap: same sends, same order as main's logic (incl. a stored
  // event, an event without a phone and an all-day event, all skipped).
  {
    const events = Array.from({ length: 30 }, (_, i) => mockEvent(i));
    events.push({ id: "evt-nophone", summary: "RDV — X", description: "no phone here", start: { dateTime: events[3].start!.dateTime } });
    events.push({ id: "evt-allday", summary: "RDV — Y", description: "Tel : +15550009999", start: {} });
    const stored = [{ eventId: "evt-0005", clientPhone: "+15559999999", status: "sent" }];
    const f = fakeDeps(TENANT_A.id, events, memoryLimiter(), { stored });
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(f.sends, mainLogicSends("en", events, new Set(["evt-0005"])));
    assert.equal(f.sends.length, 29);
    assert.deepEqual(c, { events: 31, sent: 29, failed: 0, skipped: 2, capped: 0, deduped: 0 });
    assert.equal(capped(f.logs).length, 0, "no capped event under the cap");
  }

  // Ordering: events out of order are sent earliest first.
  {
    const events = [mockEvent(5), mockEvent(1), mockEvent(3)];
    const f = fakeDeps(TENANT_A.id, events, memoryLimiter());
    await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(f.recorded, ["evt-0001", "evt-0003", "evt-0005"]);
  }

  // 120 events → 100 sent, 20 skipped, the 20 not recorded, one capped event.
  {
    const events = Array.from({ length: 120 }, (_, i) => mockEvent(i));
    const f = fakeDeps(TENANT_A.id, [...events].reverse(), memoryLimiter());
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.equal(c.sent, 100);
    assert.equal(c.capped, 20);
    assert.equal(c.skipped, 20);
    assert.equal(f.sends.length, 100);
    assert.deepEqual(f.recorded, events.slice(0, 100).map((e) => e.id), "the earliest 100 are sent and recorded");
    const cl = capped(f.logs);
    assert.equal(cl.length, 1, "one capped event per tenant");
    assert.deepEqual(cl[0].metadata, { sent: 100, skipped: 20, scope: "account" });
    assert.equal(cl[0].userId, TENANT_A.id);
    // No PII: no number, name, event id or event text anywhere in the event.
    const blob = JSON.stringify(cl[0]);
    assert.doesNotMatch(blob, /\+?1555\d/, "no phone number");
    assert.doesNotMatch(blob, /Client|evt-|Test centre|RDV/, "no name, event id or event text");
    // Next run (rolling window, a later day): the 20 are not marked as done.
    assert.ok(!f.recorded.some((id) => events.slice(100).some((e) => e.id === id)));
  }

  // Failed sends count against the cap too (the attempt is consumed first).
  {
    const events = Array.from({ length: 3 }, (_, i) => mockEvent(i));
    const failTo = new Set([parseEventContact(events[1]).phone as string]);
    const f = fakeDeps(TENANT_A.id, events, memoryLimiter({ windowMs: 1000, perAccount: 2, global: 100 }), { failTo });
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(c, { events: 3, sent: 1, failed: 1, skipped: 1, capped: 1, deduped: 0 });
    assert.deepEqual(capped(f.logs)[0].metadata, { sent: 2, skipped: 1, scope: "account" });
  }

  // Global ceiling across tenants: A takes 4 of 5, B gets 1 then is capped.
  {
    const limiter = memoryLimiter({ windowMs: 1000, perAccount: 4, global: 5 });
    const a = fakeDeps(TENANT_A.id, Array.from({ length: 4 }, (_, i) => mockEvent(i)), limiter);
    const ca = await remindTenant(TENANT_A, TOMORROW, a.deps);
    assert.equal(ca.sent, 4);
    assert.equal(capped(a.logs).length, 0);
    const b = fakeDeps(TENANT_B.id, Array.from({ length: 3 }, (_, i) => mockEvent(i + 10)), limiter);
    const cb = await remindTenant(TENANT_B, TOMORROW, b.deps);
    assert.equal(cb.sent, 1);
    assert.equal(cb.capped, 2);
    assert.deepEqual(capped(b.logs)[0].metadata, { sent: 1, skipped: 2, scope: "global" });
    // A third tenant is fully capped by the global ceiling.
    const tenantC = { id: "00000000-0000-4000-8000-00000000000c", primaryLanguage: "he" };
    const c = fakeDeps(tenantC.id, [mockEvent(20)], limiter);
    assert.equal((await remindTenant(tenantC, TOMORROW, c.deps)).capped, 1);
    assert.equal(c.sends.length, 0);
  }

  // Per-destination dedup: one number with 3 events → one reminder, for the
  // earliest event; dedup does not consume the cap.
  {
    const events = [mockEvent(7, 42), mockEvent(2, 42), mockEvent(4, 43), mockEvent(9, 42)];
    let consumed = 0;
    const lim = memoryLimiter();
    const f = fakeDeps(TENANT_A.id, events, async (id) => {
      consumed++;
      return lim(id);
    });
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(f.recorded, ["evt-0002", "evt-0004"]);
    assert.deepEqual(c, { events: 4, sent: 2, failed: 0, skipped: 2, capped: 0, deduped: 2 });
    assert.equal(consumed, 2);
  }

  // Dedup across a rerun: a number already reminded (stored "sent") for
  // tomorrow is not reminded again for its other event; a stored "failed"
  // row does not block the number's other event.
  {
    const events = [mockEvent(1, 50), mockEvent(2, 50), mockEvent(3, 51), mockEvent(4, 51)];
    const phone50 = parseEventContact(events[0]).phone as string;
    const phone51 = parseEventContact(events[2]).phone as string;
    const stored = [
      { eventId: "evt-0001", clientPhone: phone50, status: "sent" },
      { eventId: "evt-0003", clientPhone: phone51, status: "failed" },
    ];
    const f = fakeDeps(TENANT_A.id, events, memoryLimiter(), { stored });
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(f.recorded, ["evt-0004"]);
    assert.equal(c.deduped, 1);
  }

  console.log("appointment-reminders-cap pure part passed");
}

async function part2(url: string) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
  process.env.DATABASE_URL = url;
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { consumeRateLimit } = await import("../../lib/rate-limit-db");
  await db.execute(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  const real = (accountId: string) =>
    consumeRateLimit({
      bucket: REMINDERS_RATE_BUCKET,
      accountId,
      windowMs: REMINDERS_CAP_WINDOW_MS,
      perAccount: REMINDERS_PER_TENANT_PER_DAY,
      global: REMINDERS_GLOBAL_PER_DAY,
    });

  const events = Array.from({ length: 120 }, (_, i) => mockEvent(i));
  const f = fakeDeps(TENANT_A.id, events, real);
  const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
  assert.equal(c.sent, 100);
  assert.equal(c.capped, 20);
  assert.equal(capped(f.logs).length, 1);
  // A second run the same day: the tenant is still capped (the window holds).
  const again = fakeDeps(TENANT_A.id, events.slice(100), real);
  assert.equal((await remindTenant(TENANT_A, TOMORROW, again.deps)).capped, 20);
  assert.equal(again.sends.length, 0);
  // Another tenant is not affected by A's cap.
  const b = fakeDeps(TENANT_B.id, [mockEvent(500)], real);
  assert.equal((await remindTenant(TENANT_B, TOMORROW, b.deps)).sent, 1);
  // The ledger holds tenant ids + timestamps only.
  const rows = (await db.execute(sql`SELECT value FROM app_settings WHERE key = 'rate_limit:appointment_reminders'`)) as unknown as { value: string }[];
  const ledger = JSON.parse(rows[0].value) as Record<string, number[]>;
  assert.deepEqual(Object.keys(ledger).sort(), [TENANT_A.id, TENANT_B.id]);
  assert.equal(ledger[TENANT_A.id].length, 100);
  assert.doesNotMatch(rows[0].value, /1555/);
  console.log("ALL APPOINTMENT-REMINDERS-CAP DB TESTS PASSED");
}

async function main() {
  await part1();
  const url = process.env.REMINDERS_CAP_DB_TEST_URL;
  if (!url) {
    console.log("SKIPPED appointment-reminders-cap DB part (set REMINDERS_CAP_DB_TEST_URL — see scripts/appointment-reminders-cap-db.sh)");
    process.exit(0);
  }
  await part2(url);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
