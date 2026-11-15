// Canned answers for the public home demo's tools (components/VoiceAgent.tsx,
// routed by lib/demo-session.ts DEMO_TOOL_ROUTES to app/api/demo/tools/[tool]).
//
// The home demo never reads or writes a real calendar or sheet, whoever is
// visiting: an anonymous visitor used to see the free/busy slots of the env
// GOOGLE_CALENDAR_ID, and a signed-in visitor used to book into their own
// calendar and sheet. Here every answer is built from the clock alone.
//
// Shapes are copied from the anonymous "demo" branch /api/calendar/* and
// /api/sheets/contact used to have (removed: those routes now answer 401 to
// anonymous callers), so the model sees the same field names and value types
// as before:
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
// Every text the model reads (summary, reason, error, suggested_dates
// weekday) is in the visitor's language, with dates and times written for
// that locale (DEMO_TEXT below). Field names and value types never change;
// machine values (date, available_slots, suggested_dates[].date) stay
// YYYY-MM-DD / HH:MM in every language.
//
// PURE: no Google client, no DB, no logger. scripts/tests/demo-tools.test.ts
// checks the import list.

import { parseBookingRequest, type BookingParseError } from "@/lib/booking-request";
import {
  DEMO_CLOSE_TIME,
  DEMO_OPEN_DAYS,
  DEMO_PLACE,
  DEMO_PLACE_ID,
  DEMO_SLOTS,
  demoLang,
  type DemoLang,
} from "@/lib/demo-place";
import type { DateForCenter } from "@/lib/schedule";
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

/** BCP 47 locale per demo language, for Intl date and time formatting. */
const LOCALE: Readonly<Record<DemoLang, string>> = { fr: "fr-FR", en: "en-US", he: "he-IL" };

const utcDate = (date: string, time = "00:00"): Date => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi));
};

/** The weekday of a YYYY-MM-DD civil date, in the visitor's language ("lundi", "Monday", "יום שני"). */
export function demoWeekday(date: string, lang: DemoLang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "UTC", weekday: "long" }).format(utcDate(date));
}

/**
 * A civil date for speech: "jeudi 12 novembre", "Thursday, November 12",
 * "יום חמישי, 12 בנובמבר". The year is added only when it is not `today`'s.
 */
export function demoDateText(date: string, lang: DemoLang, today: string): string {
  const withYear = date.slice(0, 4) !== today.slice(0, 4);
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(utcDate(date));
}

/** A HH:MM wall-clock time for speech: "11h30" / "10h", "11:30 AM", "11:30". */
export function demoTimeText(time: string, lang: DemoLang): string {
  if (lang === "fr") {
    const [h, m] = time.split(":");
    return `${Number(h)}h${m === "00" ? "" : m}`;
  }
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: lang === "en",
  }).format(utcDate("2000-01-01", time));
}

const listText = (items: string[], lang: DemoLang): string =>
  new Intl.ListFormat(lang, { type: "conjunction", style: "long" }).format(items);

const rawText = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? ""));

interface DemoText {
  dateRequired: string;
  dateInvalid: (date: string) => string;
  booking: Record<BookingParseError, (args: Record<string, unknown>) => string>;
  slotPast: (date: string, time: string) => string;
  contactRequired: string;
  noSlot: (date: string, suggested: string) => string;
  noSlotNoDate: (date: string, days: number) => string;
  summary: (date: string, time: string, name: string, place: string) => string;
  unknownTool: (tool: string) => string;
  rateLimited: string;
}

/** Every text the model can read, per language. The Hebrew is [HE] to confirm. */
const DEMO_TEXT: Readonly<Record<DemoLang, DemoText>> = {
  fr: {
    dateRequired: "Date requise (format YYYY-MM-DD).",
    dateInvalid: (d) => `Date invalide : ${d} (format attendu YYYY-MM-DD).`,
    booking: {
      missing_fields: () => "Il manque le nom, le téléphone, la date ou l'heure du rendez-vous.",
      invalid_date: (a) => `Date invalide : ${rawText(a.date)} (format attendu YYYY-MM-DD).`,
      invalid_time: (a) => `Heure invalide : ${rawText(a.time)} (format attendu HH:MM, de 00:00 à 23:59).`,
      invalid_duration: (a) => `Durée invalide : ${rawText(a.duration)} (en minutes, un entier entre 5 et 480).`,
    },
    slotPast: (d, t) => `Le créneau du ${d} à ${t} est déjà passé. Propose un horaire à venir.`,
    contactRequired: "Le nom et le téléphone sont requis.",
    noSlot: (d, s) => `Plus de créneau disponible le ${d}. Prochaines dates disponibles : ${s}.`,
    noSlotNoDate: (d, n) => `Plus de créneau disponible le ${d}, ni dans les ${n} jours qui suivent.`,
    summary: (d, t, n, p) => `Rendez-vous confirmé le ${d} à ${t} pour ${n}, à ${p}.`,
    unknownTool: (t) => `Outil inconnu : ${t}.`,
    rateLimited: "Trop de demandes pour la démo, réessaie plus tard.",
  },
  en: {
    dateRequired: "A date is required (format YYYY-MM-DD).",
    dateInvalid: (d) => `Invalid date: ${d} (expected YYYY-MM-DD).`,
    booking: {
      missing_fields: () => "The booking needs a name, a phone number, a date and a time.",
      invalid_date: (a) => `Invalid date: ${rawText(a.date)} (expected YYYY-MM-DD).`,
      invalid_time: (a) => `Invalid time: ${rawText(a.time)} (expected HH:MM, 00:00 to 23:59).`,
      invalid_duration: (a) => `Invalid duration: ${rawText(a.duration)} (minutes, a whole number from 5 to 480).`,
    },
    slotPast: (d, t) => `The ${t} slot on ${d} has already passed. Offer a time that is still ahead.`,
    contactRequired: "A name and a phone number are required.",
    noSlot: (d, s) => `No slot left on ${d}. Next available dates: ${s}.`,
    noSlotNoDate: (d, n) => `No slot left on ${d}, nor in the ${n} days after it.`,
    summary: (d, t, n, p) => `Appointment confirmed on ${d} at ${t} for ${n}, at ${p}.`,
    unknownTool: (t) => `Unknown tool: ${t}.`,
    rateLimited: "Too many demo requests, try again later.",
  },
  // [HE] to confirm: every Hebrew string below.
  he: {
    dateRequired: "נדרש תאריך (בפורמט YYYY-MM-DD).",
    dateInvalid: (d) => `תאריך לא תקין: ${d} (נדרש פורמט YYYY-MM-DD).`,
    booking: {
      missing_fields: () => "חסרים שם, מספר טלפון, תאריך או שעה לקביעת התור.",
      invalid_date: (a) => `תאריך לא תקין: ${rawText(a.date)} (נדרש פורמט YYYY-MM-DD).`,
      invalid_time: (a) => `שעה לא תקינה: ${rawText(a.time)} (נדרש פורמט HH:MM, בין 00:00 ל-23:59).`,
      invalid_duration: (a) => `משך לא תקין: ${rawText(a.duration)} (בדקות, מספר שלם בין 5 ל-480).`,
    },
    slotPast: (d, t) => `התור ב${d} בשעה ${t} כבר עבר. הצע שעה עתידית.`,
    contactRequired: "נדרשים שם ומספר טלפון.",
    noSlot: (d, s) => `אין יותר תורים פנויים ב${d}. התאריכים הפנויים הבאים: ${s}.`,
    noSlotNoDate: (d, n) => `אין יותר תורים פנויים ב${d}, וגם לא ב-${n} הימים שאחריו.`,
    // The prefix ב absorbs the article: "ב" + "הסלון" is "בסלון".
    summary: (d, t, n, p) => `התור אושר ל${d} בשעה ${t} עבור ${n}, ב${p.replace(/^ה/, "")}.`,
    unknownTool: (t) => `כלי לא מוכר: ${t}.`,
    rateLimited: "יותר מדי בקשות להדגמה, נסה שוב מאוחר יותר.",
  },
};

/** The endpoint's own errors (unknown tool, rate limited), in the visitor's language. */
export function demoEndpointText(lang: unknown): { unknownTool: (tool: string) => string; rateLimited: string } {
  const t = DEMO_TEXT[demoLang(lang)];
  return { unknownTool: t.unknownTool, rateLimited: t.rateLimited };
}

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
    if (cannedSlots(d, durationMin, nowMs, lang).length > 0) out.push({ date: d, weekday: demoWeekday(d, lang) });
  }
  return out;
}

function checkAvailability(args: Record<string, unknown>, nowMs: number, lang: DemoLang): DemoToolAnswer {
  const text = DEMO_TEXT[lang];
  const date = str(args.date);
  if (!date) return { status: 400, body: { error: text.dateRequired } };
  if (!isRealDate(date)) return { status: 400, body: { error: text.dateInvalid(date) } };
  const duration = args.duration;
  const durationMin =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;
  const slots = cannedSlots(date, durationMin, nowMs, lang);
  const base = { date, center: DEMO_PLACE_ID, label: DEMO_PLACE[lang], available_slots: slots };
  if (slots.length > 0) return { status: 200, body: base };
  const today = jerusalemDateAt(nowMs);
  const suggested = suggestedDates(date < today ? today : date, durationMin, nowMs, lang);
  const day = demoDateText(date, lang, today);
  const reason =
    suggested.length > 0
      ? text.noSlot(day, listText(suggested.map((d) => demoDateText(d.date, lang, today)), lang))
      : text.noSlotNoDate(day, SUGGEST_HORIZON_DAYS);
  return { status: 200, body: { ...base, reason, suggested_dates: suggested } };
}

function bookAppointment(args: Record<string, unknown>, nowMs: number, lang: DemoLang): DemoToolAnswer {
  const text = DEMO_TEXT[lang];
  const parsed = parseBookingRequest(args);
  if (!parsed.ok) return { status: 400, body: { error: text.booking[parsed.code](args) } };
  // Any `center` the model sends is ignored: the demo has one place.
  const { name, date, time } = parsed.value;
  const today = jerusalemDateAt(nowMs);
  if (atMs(date, time) < nowMs - PAST_GRACE_MS) {
    return { status: 400, body: { error: text.slotPast(demoDateText(date, lang, today), demoTimeText(time, lang)) } };
  }
  return {
    status: 200,
    body: {
      success: true,
      simulated: true,
      center: DEMO_PLACE_ID,
      summary: text.summary(demoDateText(date, lang, today), demoTimeText(time, lang), name, DEMO_PLACE[lang]),
    },
  };
}

function saveContact(args: Record<string, unknown>, lang: DemoLang): DemoToolAnswer {
  if (!args.name || !args.phone) return { status: 400, body: { error: DEMO_TEXT[lang].contactRequired } };
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
      return saveContact(args, l);
  }
}
