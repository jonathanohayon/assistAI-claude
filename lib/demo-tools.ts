// Canned answers for the public home demo's tools (components/VoiceAgent.tsx,
// routed by lib/demo-session.ts DEMO_TOOL_ROUTES to app/api/demo/tools/[tool]).
//
// The home demo never reads or writes a real calendar or sheet, whoever is
// visiting: an anonymous visitor used to see the free/busy slots of the env
// GOOGLE_CALENDAR_ID, and a signed-in visitor used to book into their own
// calendar and sheet. Here every answer is built from the clock alone.
//
// Shapes are copied from the anonymous "demo" branch of /api/calendar/* and
// /api/sheets/contact (lib/demo-sandbox.ts), so the model sees the same field
// names and value types as before:
//   check_availability → { date, center, label, available_slots[, reason, suggested_dates] }
//   book_appointment   → { success, simulated, center, summary }
//   save_contact       → { success, simulated }
//   errors             → { error } with a 400
//
// Canned calendar, wall clock Asia/Jerusalem (the zone every other calendar
// tool uses): Sunday to Thursday, 10:00 / 11:30 / 15:00, closing at 18:00.
// A slot starting in less than 30 min is hidden, as computeFreeSlots does.
//
// PURE: no Google client, no DB, no logger. scripts/tests/demo-tools.test.ts
// checks the import list.

import { parseBookingRequest } from "@/lib/booking-request";
import { atPlace, resolvePlace } from "@/lib/booking-place";
import { centerForDate, dayNameFr, labelFor, type DateForCenter } from "@/lib/schedule";
import { JERUSALEM_TZ, jerusalemToUTCISO } from "@/lib/tz";

export const DEMO_TOOLS_BASE = "/api/demo/tools";

export const DEMO_TOOL_NAMES = ["check_availability", "book_appointment", "save_contact"] as const;
export type DemoToolName = (typeof DEMO_TOOL_NAMES)[number];

export const isDemoToolName = (v: string): v is DemoToolName =>
  (DEMO_TOOL_NAMES as readonly string[]).includes(v);

export const demoToolEndpoint = (name: DemoToolName): string => `${DEMO_TOOLS_BASE}/${name}`;

/**
 * Public endpoint, counted in the shared DB limiter like /api/session's demo
 * path. A demo session is capped at 5 per IP per 10 min; a call makes a
 * handful of tool calls, so 60 per IP leaves room for a long conversation and
 * stops a script. The global cap matches 100 sessions x 15 calls.
 */
export const DEMO_TOOLS_BUCKET = "demo_tools";
export const DEMO_TOOLS_WINDOW_MS = 10 * 60_000;
export const DEMO_TOOLS_PER_IP = 60;
export const DEMO_TOOLS_GLOBAL = 1500;

/** Canned free starts on an open day (HH:MM, Asia/Jerusalem). */
export const DEMO_SLOTS = ["10:00", "11:30", "15:00"] as const;
/** Open weekdays (0 = Sunday): Sunday to Thursday. */
export const DEMO_OPEN_DAYS: readonly number[] = [0, 1, 2, 3, 4];
const CLOSE_TIME = "18:00";
const SLOT_BUFFER_MS = 30 * 60_000;
const PAST_GRACE_MS = 5 * 60_000;
const SUGGESTED_COUNT = 3;
const SUGGEST_HORIZON_DAYS = 60;

export interface DemoToolAnswer {
  status: number;
  body: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The civil date in Asia/Jerusalem at `nowMs`, YYYY-MM-DD. */
export function jerusalemDateAt(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const weekday = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const atMs = (date: string, time: string): number =>
  new Date(jerusalemToUTCISO(date, `${time}:00`)).getTime();

/** The canned free starts on `date` for a `durationMin` service, never in the past. */
export function cannedSlots(date: string, durationMin: number, nowMs: number): string[] {
  if (!DEMO_OPEN_DAYS.includes(weekday(date))) return [];
  if (date < jerusalemDateAt(nowMs)) return [];
  const closeMs = atMs(date, CLOSE_TIME);
  return DEMO_SLOTS.filter((t) => {
    const startMs = atMs(date, t);
    return startMs > nowMs + SLOT_BUFFER_MS && startMs + durationMin * 60_000 <= closeMs;
  });
}

/** The next open dates strictly after `after` that still have a slot. */
function suggestedDates(after: string, durationMin: number, nowMs: number): DateForCenter[] {
  const out: DateForCenter[] = [];
  for (let i = 1; i <= SUGGEST_HORIZON_DAYS && out.length < SUGGESTED_COUNT; i++) {
    const d = addDays(after, i);
    if (cannedSlots(d, durationMin, nowMs).length > 0) out.push({ date: d, weekday: dayNameFr(d) });
  }
  return out;
}

function checkAvailability(args: Record<string, unknown>, nowMs: number): DemoToolAnswer {
  const date = str(args.date);
  if (!date) return { status: 400, body: { error: "date requise (YYYY-MM-DD)" } };
  if (!isRealDate(date)) {
    return { status: 400, body: { error: `date invalide : ${date} (YYYY-MM-DD attendu)` } };
  }
  const duration = args.duration;
  const durationMin =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;
  const center = centerForDate(date);
  const slots = cannedSlots(date, durationMin, nowMs);
  const base = { date, center, label: labelFor(center), available_slots: slots };
  if (slots.length > 0) return { status: 200, body: base };
  const today = jerusalemDateAt(nowMs);
  const suggested = suggestedDates(date < today ? today : date, durationMin, nowMs);
  return {
    status: 200,
    body: {
      ...base,
      reason: `Plus de créneau disponible pour le ${date}. Prochaines dates disponibles : ${suggested.map((d) => `${d.weekday} ${d.date}`).join(", ")}.`,
      suggested_dates: suggested,
    },
  };
}

function bookAppointment(args: Record<string, unknown>, nowMs: number): DemoToolAnswer {
  const parsed = parseBookingRequest(args);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const { name, date, time } = parsed.value;
  // The demo tool has no `center` argument: the weekday's centre, as the
  // legacy route resolves it when none is given.
  const placed = resolvePlace({}, date);
  if (!placed.ok) {
    return { status: 400, body: { error: placed.kind === "invalid_date" ? placed.error : placed.refusal.reason } };
  }
  if (atMs(date, time) < nowMs - PAST_GRACE_MS) {
    return { status: 400, body: { error: `Le créneau ${date} ${time} est déjà passé. Propose un horaire futur.` } };
  }
  const { place } = placed;
  return {
    status: 200,
    body: {
      success: true,
      simulated: true,
      ...(place.kind === "legacy" ? { center: place.center } : { location: place.label }),
      summary: `RDV confirmé le ${date} à ${time} pour ${name}${atPlace(place)}`,
    },
  };
}

function saveContact(args: Record<string, unknown>): DemoToolAnswer {
  if (!args.name || !args.phone) return { status: 400, body: { error: "Nom et téléphone requis" } };
  return { status: 200, body: { success: true, simulated: true } };
}

/** The canned answer to one demo tool call. Stores nothing, reads only the clock it is given. */
export function runDemoTool(name: DemoToolName, rawArgs: unknown, nowMs: number): DemoToolAnswer {
  const args = asRecord(rawArgs);
  switch (name) {
    case "check_availability":
      return checkAvailability(args, nowMs);
    case "book_appointment":
      return bookAppointment(args, nowMs);
    case "save_contact":
      return saveContact(args);
  }
}
