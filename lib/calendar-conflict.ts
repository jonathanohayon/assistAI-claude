// Deterministic overlap / availability guard for bookings.
//
// WHY this exists: the LLM agent cannot reliably do time arithmetic
// ("does a 60-min service at 10:30 collide with an 11:00 booking?"). No
// amount of prompt instruction fixes that — the rule MUST be enforced in
// code. This module is the single source of truth for "is this slot free?"
// and is consumed by the book / availability / reschedule routes so the
// constraint can never be bypassed.
//
// See lib/schedule.ts for the companion centre/day rules.
import type { calendar_v3 } from "@googleapis/calendar";

import { logEvent } from "@/lib/logger";
import { JERUSALEM_TZ, jerusalemToUTCISO } from "@/lib/tz";

/**
 * Mesure la durée d'un appel Google `events.list` et la logge (fire-and-forget
 * pour ne pas ajouter de latence à la mesure). Visible dans /dashboard/logs
 * (source=calendar, event=google_events_list_latency). Sert à décider si un
 * cache/miroir DB des créneaux occupés vaut le coup vs la latence réelle.
 */
async function timedEventsList(
  calendar: calendar_v3.Calendar,
  params: calendar_v3.Params$Resource$Events$List,
  op: string,
) {
  const t0 = Date.now();
  try {
    const res = await calendar.events.list(params);
    const ms = Date.now() - t0;
    void logEvent({
      source: "calendar",
      event: "google_events_list_latency",
      level: ms > 800 ? "warn" : "info",
      message: `events.list ${op} → ${ms}ms (${res.data.items?.length ?? 0} events)`,
      metadata: { op, ms, calendarId: params.calendarId, count: res.data.items?.length ?? 0 },
    });
    return res;
  } catch (e) {
    const ms = Date.now() - t0;
    void logEvent({
      source: "calendar",
      event: "google_events_list_error",
      level: "error",
      message: `events.list ${op} échoué après ${ms}ms : ${(e as Error).message?.slice(0, 150)}`,
      metadata: { op, ms, calendarId: params.calendarId },
    });
    throw e;
  }
}

// Business hours (wall clock, Asia/Jerusalem). Slots sit on a 30-min grid;
// a candidate start is only valid if the FULL service duration fits before
// closing time. Kept here so book + availability agree on the same window.
const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
const GRID_MIN = 30;
// Hide slots starting in <30 min: by the time la cliente confirme et qu'on
// book, "dans 5 min" est déjà passé.
const SLOT_BUFFER_MS = 30 * 60_000;

export interface CalendarConflict {
  summary: string;
  start: string; // ISO dateTime
  end: string; // ISO dateTime
}

export interface BusyInterval {
  s: number; // start epoch ms
  e: number; // end epoch ms
}

/**
 * Do [aS, aE) and [bS, bE) overlap? Edge-touching is NOT an overlap: an event
 * ending exactly when another starts is fine. This is the single predicate
 * the whole module relies on — pure + unit-tested in scripts/tests.
 */
export function intervalsOverlap(
  aS: number,
  aE: number,
  bS: number,
  bE: number,
): boolean {
  return aS < bE && aE > bS;
}

/**
 * Pure slot generator: given busy intervals (epoch ms), return the "HH:MM"
 * starts on `date` where a `durationMin` service fits within business hours
 * without overlapping. `nowMs` drives the "too soon / past" buffer — passed
 * in (not read from the clock) so this is deterministic and testable.
 */
export function freeSlotsFromBusy(
  date: string,
  durationMin: number,
  busy: BusyInterval[],
  nowMs: number,
): string[] {
  const closeMs = new Date(
    jerusalemToUTCISO(date, `${String(CLOSE_HOUR).padStart(2, "0")}:00:00`),
  ).getTime();

  const slots: string[] = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    for (let m = 0; m < 60; m += GRID_MIN) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const startMs = new Date(
        jerusalemToUTCISO(date, `${hh}:${mm}:00`),
      ).getTime();
      const endMs = startMs + durationMin * 60_000;
      if (endMs > closeMs) continue; // service would run past closing
      if (startMs <= nowMs + SLOT_BUFFER_MS) continue; // too soon / past
      const clash = busy.some((b) => intervalsOverlap(startMs, endMs, b.s, b.e));
      if (!clash) slots.push(`${hh}:${mm}`);
    }
  }
  return slots;
}

/** Events that actually block a slot: timed (not all-day) and not "free". */
function blockingIntervals(
  items: calendar_v3.Schema$Event[],
  excludeEventId?: string,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const ev of items) {
    if (excludeEventId && ev.id === excludeEventId) continue;
    if (ev.transparency === "transparent") continue; // marked "free" → ignore
    const s = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : null;
    const e = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : null;
    if (s == null || e == null) continue; // all-day (date-only) → not a slot block
    out.push({ s, e });
  }
  return out;
}

/**
 * Existing events overlapping [date+time, +durationMin) in `calendarId`.
 * Edge-touching is allowed: an event ending at 11:00 does NOT conflict with a
 * booking starting at 11:00. `excludeEventId` lets reschedule ignore the event
 * being moved. Empty array ⇒ the slot is free.
 */
export async function findConflicts(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  date: string,
  time: string,
  durationMin: number,
  excludeEventId?: string,
): Promise<CalendarConflict[]> {
  const startMs = new Date(jerusalemToUTCISO(date, `${time}:00`)).getTime();
  const endMs = startMs + durationMin * 60_000;

  // Google's events.list timeMin is exclusive on end time and timeMax
  // exclusive on start time — which already matches our edge-touching rule —
  // but we re-check in JS to be robust to all-day events and TZ edge cases.
  const res = await timedEventsList(
    calendar,
    {
      calendarId,
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      timeZone: JERUSALEM_TZ,
    },
    "findConflicts",
  );

  const conflicts: CalendarConflict[] = [];
  for (const ev of res.data.items || []) {
    if (excludeEventId && ev.id === excludeEventId) continue;
    if (ev.transparency === "transparent") continue;
    const bs = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : null;
    const be = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : null;
    if (bs == null || be == null) continue;
    if (intervalsOverlap(startMs, endMs, bs, be)) {
      conflicts.push({
        summary: ev.summary || "RDV",
        start: ev.start!.dateTime!,
        end: ev.end!.dateTime!,
      });
    }
  }
  return conflicts;
}

/**
 * Free start times ("HH:MM") on `date` where a `durationMin` service fits
 * entirely within business hours without overlapping any existing event.
 *
 * Fixes the bug where availability was computed on a fixed 30-min window:
 * a 60-min service was offered 11:00 whenever 11:00–11:30 was free, even if
 * 11:30–12:00 was already booked. Here the whole [start, start+duration)
 * window must be clear.
 */
export async function computeFreeSlots(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  date: string,
  durationMin: number,
): Promise<string[]> {
  const timeMin = jerusalemToUTCISO(date, "08:00:00");
  const timeMax = jerusalemToUTCISO(date, "20:00:00");
  const res = await timedEventsList(
    calendar,
    {
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      timeZone: JERUSALEM_TZ,
    },
    "computeFreeSlots",
  );

  const busy = blockingIntervals(res.data.items || []);
  return freeSlotsFromBusy(date, durationMin, busy, Date.now());
}
