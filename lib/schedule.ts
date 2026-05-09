// Rules of which center is open which day. Single source of truth — used by
// the booking API to refuse appointments at the wrong center, and by the
// availability API to return only slots that respect the constraint.
//
// Current rules (Prestige):
//   Monday    → Ashdod only
//   Wednesday → Natanya only
//   All other days (Tue/Thu/Fri/Sat/Sun) → Jérusalem only

export type Center = "jerusalem" | "ashdod" | "natanya";

export const CENTERS: Center[] = ["jerusalem", "ashdod", "natanya"];

const CENTER_LABEL: Record<Center, string> = {
  jerusalem: "Jérusalem",
  ashdod: "Ashdod",
  natanya: "Natanya",
};

export const labelFor = (c: Center): string => CENTER_LABEL[c];

/**
 * Return the unique center open on the given YYYY-MM-DD date.
 * The day-of-week is computed in Israel's timezone-agnostic civil calendar
 * (no DST shenanigans for date-only resolution).
 */
export function centerForDate(yyyyMmDd: string): Center {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => Number(s));
  if (!y || !m || !d) {
    throw new Error(`date invalide : ${yyyyMmDd} (YYYY-MM-DD attendu)`);
  }
  // Use UTC midnight + getUTCDay to avoid TZ drift.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  if (dow === 1) return "ashdod";
  if (dow === 3) return "natanya";
  return "jerusalem";
}

export interface ValidationError {
  ok: false;
  expectedCenter: Center;
  expectedLabel: string;
  reason: string;
}

export interface ValidationOk {
  ok: true;
  center: Center;
  label: string;
}

export type ValidationResult = ValidationOk | ValidationError;

/**
 * Check that the requested center matches the rule for the given date.
 * Pass `requested = null` to skip the equality check and just compute the
 * canonical center for that date.
 */
export function validateBooking(
  date: string,
  requested: Center | null,
): ValidationResult {
  const expected = centerForDate(date);
  if (requested && requested !== expected) {
    return {
      ok: false,
      expectedCenter: expected,
      expectedLabel: CENTER_LABEL[expected],
      reason: `Le ${date} (${dayNameFr(date)}), seul le centre ${CENTER_LABEL[expected]} est ouvert. Le centre ${CENTER_LABEL[requested]} ne reçoit pas ce jour-là.`,
    };
  }
  return { ok: true, center: expected, label: CENTER_LABEL[expected] };
}

const DAY_NAMES_FR = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

export function dayNameFr(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => Number(s));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAY_NAMES_FR[dow] ?? "?";
}
