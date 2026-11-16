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
import {
  REMINDER_TIMES_LABEL_MAX,
  formatDateLabel,
  parseEventContact,
  reminderText,
  reminderTimesLabel,
} from "../../lib/reminders";
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
type SentFull = { to: string; body: string; templateSid: string | undefined; templateVariables: Record<string, string> | undefined };
type Recorded = Parameters<ReminderDeps["record"]>[0];

/** Fake deps; `limiter` is shared between tenants to model the global ceiling. */
function fakeDeps(
  tenantId: string,
  events: ReminderCalendarEvent[],
  limiter: (accountId: string) => Promise<RateLimitResult>,
  opts: { stored?: Array<{ eventId: string; clientPhone: string; status: string }>; failTo?: Set<string> } = {},
) {
  const sends: Sent[] = [];
  const full: SentFull[] = [];
  const rows: Recorded[] = [];
  const recorded: string[] = [];
  const logs: ReminderLogEvent[] = [];
  const deps: ReminderDeps = {
    listEvents: async () => events,
    alreadyReminded: async (ids) => (opts.stored ?? []).filter((r) => ids.includes(r.eventId)),
    callNumber: async () => CALL_NUMBER,
    consume: () => limiter(tenantId),
    send: async (o) => {
      const { to, body } = o;
      sends.push({ to, body });
      full.push({ ...o });
      return opts.failTo?.has(to) ? { ok: false, error: "mock failure" } : { ok: true, sid: `SM${sends.length}` };
    },
    record: async (row) => {
      recorded.push(row.eventId);
      rows.push(row);
    },
    log: async (ev) => {
      logs.push(ev);
    },
  };
  return { deps, sends, full, rows, recorded, logs };
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
    assert.deepEqual(c, { events: 31, sent: 29, failed: 0, skipped: 2, capped: 0, deduped: 0, merged: 0 });
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
    assert.deepEqual(c, { events: 3, sent: 1, failed: 1, skipped: 1, capped: 1, deduped: 0, merged: 0 });
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

  // One number with 3 events (+ another number) → one reminder per number,
  // listing all 3 times in order; all events recorded; the cap is consumed
  // once per number.
  {
    const events = [mockEvent(7, 42), mockEvent(2, 42), mockEvent(4, 43), mockEvent(9, 42)];
    let consumed = 0;
    const lim = memoryLimiter();
    const f = fakeDeps(TENANT_A.id, events, async (id) => {
      consumed++;
      return lim(id);
    });
    const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
    assert.deepEqual(f.recorded, ["evt-0002", "evt-0007", "evt-0009", "evt-0004"]);
    assert.deepEqual(c, { events: 4, sent: 2, failed: 0, skipped: 0, capped: 0, deduped: 0, merged: 2 });
    assert.equal(consumed, 2);
    assert.equal(f.sends.length, 2);
    assert.match(f.sends[0].body, /at 08:02, 08:07, and 08:09 \(Test centre\)\./);
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

  await sameNumberSeveralAppointments();
  console.log("appointment-reminders-cap pure part passed");
}

/** Mock event at a Jerusalem wall-clock time on TOMORROW (January: UTC+2). */
function evAt(id: string, hhmm: string, phoneIndex: number, center = "Test centre", name = "Dana"): ReminderCalendarEvent {
  const [h, m] = hhmm.split(":").map(Number);
  return {
    id,
    summary: `RDV ${center} — ${name}`,
    description: `${center ? `Centre : ${center}\n` : ""}Tel : +1555${String(1_000_000 + phoneIndex).slice(1)}`,
    start: { dateTime: new Date(Date.UTC(2030, 0, 15, h - 2, m)).toISOString() },
  };
}

const FAKE_SID = "HX00000000000000000000000000000000";

/** main's full per-event payload (send + record + log), one event per number. */
function mainLogicFull(tenantId: string, lang: "fr" | "he" | "en", events: ReminderCalendarEvent[]) {
  const sends: SentFull[] = [];
  const rows: Recorded[] = [];
  const logs: ReminderLogEvent[] = [];
  for (const ev of events) {
    const { name, phone, center } = parseEventContact(ev);
    const startISO = ev.start?.dateTime ?? null;
    const time = startISO
      ? new Intl.DateTimeFormat("fr-FR", { timeZone: JERUSALEM_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(startISO))
      : "";
    const text = withCallUsLine(reminderText(lang, { name, dateLabel: formatDateLabel(TOMORROW, lang), time, center }), lang, CALL_NUMBER);
    sends.push({ to: phone as string, body: text, templateSid: FAKE_SID, templateVariables: { "1": text } });
    rows.push({ eventId: ev.id as string, status: "sent", clientPhone: phone as string, error: "", appointmentStart: startISO ? new Date(startISO) : null });
    logs.push({
      source: "whatsapp",
      event: "appointment_reminder_sent",
      message: `Rappel J-1 → ${phone} (${TOMORROW} ${time})`,
      userId: tenantId,
      metadata: { eventId: ev.id, phone, sid: `SM${sends.length}` },
    });
  }
  return { sends, rows, logs };
}

async function run(lang: "fr" | "he" | "en", events: ReminderCalendarEvent[], opts: Parameters<typeof fakeDeps>[3] = {}) {
  const tenant = { id: TENANT_A.id, primaryLanguage: lang };
  const f = fakeDeps(tenant.id, events, memoryLimiter(), opts);
  const counts = await remindTenant(tenant, TOMORROW, f.deps);
  return { ...f, counts };
}

/** Message body without the call line, i.e. the reminder sentence itself. */
const sentence = (body: string) => body.split("\n\n")[0];

async function sameNumberSeveralAppointments() {
  process.env.WHATSAPP_REMINDER_TEMPLATE_SID = FAKE_SID;
  try {
    // 1 appointment per number → byte-identical payload, records and logs to main.
    for (const lang of ["fr", "en", "he"] as const) {
      const events = [evAt("e1", "10:00", 1), evAt("e2", "15:30", 2, ""), evAt("e3", "09:15", 3, "Other place", "")];
      const sorted = [events[2], events[0], events[1]];
      const r = await run(lang, events);
      const ref = mainLogicFull(TENANT_A.id, lang, sorted);
      assert.deepEqual(r.full, ref.sends, `${lang}: same sends as main`);
      assert.deepEqual(r.rows, ref.rows, `${lang}: same records as main`);
      assert.deepEqual(r.logs, ref.logs, `${lang}: same logs as main`);
      assert.equal(r.counts.merged, 0);
    }

    // 2 appointments, same number, same place → one send whose {{1}} lists both times in order.
    {
      const events = [evAt("b", "15:30", 7), evAt("a", "10:00", 7)];
      const r = await run("fr", events);
      assert.equal(r.full.length, 1);
      assert.equal(r.full[0].templateSid, FAKE_SID, "same template SID");
      assert.deepEqual(Object.keys(r.full[0].templateVariables ?? {}), ["1"], "only variable {{1}}");
      assert.equal(r.full[0].templateVariables?.["1"], r.full[0].body);
      assert.equal(
        sentence(r.full[0].body),
        `Bonjour Dana, petit rappel de vos rendez-vous demain ${formatDateLabel(TOMORROW, "fr")} à 10:00 et 15:30 (Test centre). À demain ! 😊`,
      );
      assert.deepEqual(r.rows.map((x) => [x.eventId, x.status, x.clientPhone, x.appointmentStart?.toISOString()]), [
        ["a", "sent", "+1555000007", "2030-01-15T08:00:00.000Z"],
        ["b", "sent", "+1555000007", "2030-01-15T13:30:00.000Z"],
      ]);
      assert.deepEqual(r.counts, { events: 2, sent: 1, failed: 0, skipped: 0, capped: 0, deduped: 0, merged: 1 });
      assert.deepEqual(r.logs[0].metadata, { eventId: "a", phone: "+1555000007", sid: "SM1", eventIds: ["a", "b"] });

      // Rerun: both events are stored → nothing is sent again.
      const stored = r.rows.map((x) => ({ eventId: x.eventId, clientPhone: x.clientPhone, status: x.status }));
      const again = await run("fr", events, { stored });
      assert.equal(again.full.length, 0);
      assert.equal(again.rows.length, 0);
    }

    // fr / en / he formatting, 2 and 3 appointments.
    const label = (l: "fr" | "en" | "he") => formatDateLabel(TOMORROW, l);
    const three = [evAt("x", "12:00", 8), evAt("y", "15:30", 8), evAt("w", "10:00", 8)];
    const two = three.slice(1);
    const expect: Record<"fr" | "en" | "he", [string, string]> = {
      fr: [
        `Bonjour Dana, petit rappel de vos rendez-vous demain ${label("fr")} à 10:00 et 15:30 (Test centre). À demain ! 😊`,
        `Bonjour Dana, petit rappel de vos rendez-vous demain ${label("fr")} à 10:00, 12:00 et 15:30 (Test centre). À demain ! 😊`,
      ],
      en: [
        `Hi Dana, a friendly reminder of your appointments tomorrow ${label("en")} at 10:00 and 15:30 (Test centre). See you then! 😊`,
        `Hi Dana, a friendly reminder of your appointments tomorrow ${label("en")} at 10:00, 12:00, and 15:30 (Test centre). See you then! 😊`,
      ],
      he: [
        `שלום Dana, תזכורת לתורים שלך מחר ${label("he")} בשעות 10:00 ו-15:30 (Test centre). נתראה! 😊`,
        `שלום Dana, תזכורת לתורים שלך מחר ${label("he")} בשעות 10:00, 12:00 ו-15:30 (Test centre). נתראה! 😊`,
      ],
    };
    for (const lang of ["fr", "en", "he"] as const) {
      const r2 = await run(lang, two);
      assert.equal(r2.full.length, 1);
      assert.equal(sentence(r2.full[0].body), expect[lang][0], `${lang}: 2 appointments`);
      const r3 = await run(lang, three);
      assert.equal(r3.full.length, 1, `${lang}: one send for 3 appointments`);
      assert.equal(sentence(r3.full[0].body), expect[lang][1], `${lang}: 3 appointments`);
      assert.deepEqual(r3.recorded, ["w", "x", "y"]);
      assert.equal(r3.counts.merged, 2);
      // The call line is still there.
      assert.ok(r3.full[0].body.endsWith(CALL_NUMBER) || r3.full[0].body.includes(CALL_NUMBER));
    }

    // Different places → each time carries its own place; none at the end.
    {
      const events = [evAt("p1", "10:00", 9, "Centre A"), evAt("p2", "15:30", 9, "Centre B"), evAt("p3", "17:00", 9, "")];
      const r = await run("en", events);
      assert.equal(
        sentence(r.full[0].body),
        `Hi Dana, a friendly reminder of your appointments tomorrow ${label("en")} at 10:00 (Centre A), 15:30 (Centre B), and 17:00. See you then! 😊`,
      );
    }

    // Length cap: at most 5 times listed, then "and N more"; long places clipped; label ≤ cap.
    {
      const hours = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
      const r = await run("en", hours.map((h, i) => evAt(`l${i}`, h, 10)));
      assert.match(sentence(r.full[0].body), / at 08:00, 09:00, 10:00, 11:00, 12:00, and 3 more \(Test centre\)\./);
      assert.equal(r.recorded.length, 8, "all 8 events recorded");
      assert.match(sentence((await run("fr", hours.map((h, i) => evAt(`l${i}`, h, 10)))).full[0].body), /12:00 et 3 autres/);
      assert.match(sentence((await run("he", hours.map((h, i) => evAt(`l${i}`, h, 10)))).full[0].body), /12:00 ועוד 3/);
      const long = "P".repeat(200);
      const lr = reminderTimesLabel("en", hours.map((h, i) => ({ time: h, center: `${long}${i}` })));
      assert.ok(lr.times.length <= REMINDER_TIMES_LABEL_MAX, "times label capped");
      assert.equal(lr.center, "");
      const big = await run("en", hours.map((h, i) => evAt(`g${i}`, h, 11, `${long}${i}`)));
      assert.ok(big.full[0].body.length <= 1000, "whole variable within the template limit");
      assert.ok(big.full[0].body.includes(CALL_NUMBER));
    }

    // Failed send: every event of the number is recorded as failed; one failure counted.
    {
      const r = await run("fr", [evAt("f1", "10:00", 12), evAt("f2", "11:00", 12)], { failTo: new Set(["+1555000012"]) });
      assert.deepEqual(r.rows.map((x) => [x.eventId, x.status]), [["f1", "failed"], ["f2", "failed"]]);
      assert.equal(r.counts.failed, 1);
    }

    // Cap counts one send per number: cap 1 → the first number (2 events) is
    // sent, the second number's 2 events are capped and not recorded.
    {
      const events = [evAt("c1", "10:00", 13), evAt("c2", "11:00", 13), evAt("c3", "12:00", 14), evAt("c4", "13:00", 14)];
      const f = fakeDeps(TENANT_A.id, events, memoryLimiter({ windowMs: 1000, perAccount: 1, global: 100 }));
      const c = await remindTenant(TENANT_A, TOMORROW, f.deps);
      assert.equal(f.sends.length, 1);
      assert.deepEqual(f.recorded, ["c1", "c2"]);
      assert.deepEqual(c, { events: 4, sent: 1, failed: 0, skipped: 2, capped: 2, deduped: 0, merged: 1 });
      assert.deepEqual(capped(f.logs)[0].metadata, { sent: 1, skipped: 2, scope: "account" });
    }
  } finally {
    delete process.env.WHATSAPP_REMINDER_TEMPLATE_SID;
  }
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
  // A phone would be a string ("+1555..."): a bare /1555/ also matched the
  // millisecond timestamps (e.g. 1794787461555) and failed at random.
  assert.doesNotMatch(rows[0].value, /"\+?1555/);
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
