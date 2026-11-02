// Pure validation of the agent's book_appointment request
// (POST /api/calendar/book). Unit-tested in scripts/tests/booking-request.test.ts.
//
// Before this, `time` was not format-checked ("25:99" overflowed into the next
// day and passed the past-slot check) and `duration` went to the calendar
// unchecked (negative, string, or a whole day).

export interface BookingRequest {
  name: string;
  phone: string;
  email?: string;
  date: string; // YYYY-MM-DD, a real calendar date
  time: string; // HH:MM, 00:00–23:59 ("9:30" is normalised to "09:30")
  duration: number; // minutes, integer, 5–480
  description?: string;
  center?: string;
}

export type BookingParse =
  | { ok: true; value: BookingRequest }
  | { ok: false; error: string };

export const MIN_DURATION = 5;
export const MAX_DURATION = 480;
export const DEFAULT_DURATION = 30;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function parseBookingRequest(raw: unknown): BookingParse {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = str(b.name);
  const phone = str(b.phone);
  const date = str(b.date);
  const time = str(b.time);
  if (!name || !phone || !date || !time) {
    return { ok: false, error: "Champs requis manquants (name, phone, date, time)" };
  }
  if (!isRealDate(date)) {
    return { ok: false, error: `Date invalide : ${date} (format attendu YYYY-MM-DD)` };
  }
  // "9:30" is normalised to "09:30" rather than refused: losing a booking
  // mid-call over a missing zero is worse than accepting it.
  const tm = /^(\d{1,2}):([0-5]\d)$/.exec(time);
  if (!tm || Number(tm[1]) > 23) {
    return { ok: false, error: `Heure invalide : ${time} (format attendu HH:MM, 00:00–23:59)` };
  }
  const normalizedTime = `${tm[1].padStart(2, "0")}:${tm[2]}`;
  let duration = DEFAULT_DURATION;
  if (b.duration !== undefined && b.duration !== null && b.duration !== "") {
    const n = Number(b.duration);
    if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
      return {
        ok: false,
        error: `Durée invalide : ${String(b.duration)} (minutes, entier entre ${MIN_DURATION} et ${MAX_DURATION})`,
      };
    }
    duration = n;
  }
  const email = str(b.email) || undefined;
  const description = str(b.description) || undefined;
  const center = str(b.center) || undefined;
  return {
    ok: true,
    value: { name, phone, email, date, time: normalizedTime, duration, description, center },
  };
}
