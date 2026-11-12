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
// tool uses): 10:00 / 11:30 / 15:00, closing at 18:00, on the visitor's
// working week (fr/en Monday to Friday, he Sunday to Thursday). The language
// is server-chosen: /api/session writes it into the route table
// (?lang=fr|en|he). A slot starting in less than 30 min is hidden, as
// computeFreeSlots does. One fictional place, never a real business: the
// `center` / `label` field names stay, their values are DEMO_PLACE.
//
// PURE: no Google client, no DB, no logger. scripts/tests/demo-tools.test.ts
// checks the import list.

import { parseBookingRequest } from "@/lib/booking-request";
import {
  DEMO_CLOSE_TIME,
  DEMO_OPEN_DAYS,
  DEMO_PLACE,
  DEMO_PLACE_ID,
  DEMO_SLOTS,
  demoLang,
  type DemoLang,
} from "@/lib/demo-place";
import { dayNameFr, type DateForCenter } from "@/lib/schedule";
import { JERUSALEM_TZ, jerusalemToUTCISO } from "@/lib/tz";

// The place, its week and its slots live in lib/demo-place.ts, shared with
// the demo prompt's fact sheet; re-exported for this module's callers.
export { DEMO_LANGS, DEMO_OPEN_DAYS, DEMO_PLACE, DEMO_PLACE_ID, DEMO_SLOTS, demoLang } from "@/lib/demo-place";
export type { DemoLang } from "@/lib/demo-place";

export const DEMO_TOOLS_BASE = "/api/demo/tools";

export const DEMO_TOOL_NAMES = ["check_availability", "book_appointment", "save_contact"] as const;
export type DemoToolName = (typeof DEMO_TOOL_NAMES)[number];

export const isDemoToolName = (v: string): v is DemoToolName =>
  (DEMO_TOOL_NAMES as readonly string[]).includes(v);

export const demoToolEndpoint = (name: DemoToolName, lang: unknown = "fr"): string =>
  `${DEMO_TOOLS_BASE}/${name}?lang=${demoLang(lang)}`;

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
export function cannedSlots(date: string, durationMin: number, nowMs: number, lang: DemoLang = "fr"): string[] {
  if (!DEMO_OPEN_DAYS[lang].includes(weekday(date))) return [];
  if (date < jerusalemDateAt(nowMs)) return [];
  const closeMs = atMs(date, DEMO_CLOSE_TIME);
  return DEMO_SLOTS.filter((t) => {
    const startMs = atMs(date, t);
    return startMs > nowMs + SLOT_BUFFER_MS && startMs + durationMin * 60_000 <= closeMs;
  });
}

/** The next open dates strictly after `after` that still have a slot. */
function suggestedDates(after: string, durationMin: number, nowMs: number, lang: DemoLang): DateForCenter[] {
  const out: DateForCenter[] = [];
  for (let i = 1; i <= SUGGEST_HORIZON_DAYS && out.length < SUGGESTED_COUNT; i++) {
    const d = addDays(after, i);
    if (cannedSlots(d, durationMin, nowMs, lang).length > 0) out.push({ date: d, weekday: dayNameFr(d) });
  }
  return out;
}

function checkAvailability(args: Record<string, unknown>, nowMs: number, lang: DemoLang): DemoToolAnswer {
  const date = str(args.date);
  if (!date) return { status: 400, body: { error: "date requise (YYYY-MM-DD)" } };
  if (!isRealDate(date)) {
    return { status: 400, body: { error: `date invalide : ${date} (YYYY-MM-DD attendu)` } };
  }
  const duration = args.duration;
  const durationMin =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;
  const slots = cannedSlots(date, durationMin, nowMs, lang);
  const base = { date, center: DEMO_PLACE_ID, label: DEMO_PLACE[lang], available_slots: slots };
  if (slots.length > 0) return { status: 200, body: base };
  const today = jerusalemDateAt(nowMs);
  const suggested = suggestedDates(date < today ? today : date, durationMin, nowMs, lang);
  return {
    status: 200,
    body: {
      ...base,
      reason: `Plus de créneau disponible pour le ${date}. Prochaines dates disponibles : ${suggested.map((d) => `${d.weekday} ${d.date}`).join(", ")}.`,
      suggested_dates: suggested,
    },
  };
}

function bookAppointment(args: Record<string, unknown>, nowMs: number, lang: DemoLang): DemoToolAnswer {
  const parsed = parseBookingRequest(args);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  // Any `center` the model sends is ignored: the demo has one place.
  const { name, date, time } = parsed.value;
  if (atMs(date, time) < nowMs - PAST_GRACE_MS) {
    return { status: 400, body: { error: `Le créneau ${date} ${time} est déjà passé. Propose un horaire futur.` } };
  }
  return {
    status: 200,
    body: {
      success: true,
      simulated: true,
      center: DEMO_PLACE_ID,
      summary: `RDV confirmé le ${date} à ${time} pour ${name} à ${DEMO_PLACE[lang]}`,
    },
  };
}

function saveContact(args: Record<string, unknown>): DemoToolAnswer {
  if (!args.name || !args.phone) return { status: 400, body: { error: "Nom et téléphone requis" } };
  return { status: 200, body: { success: true, simulated: true } };
}

/** The canned answer to one demo tool call. Stores nothing, reads only the clock it is given. */
export function runDemoTool(name: DemoToolName, rawArgs: unknown, nowMs: number, lang: unknown = "fr"): DemoToolAnswer {
  const args = asRecord(rawArgs);
  const l = demoLang(lang);
  switch (name) {
    case "check_availability":
      return checkAvailability(args, nowMs, l);
    case "book_appointment":
      return bookAppointment(args, nowMs, l);
    case "save_contact":
      return saveContact(args);
  }
}
