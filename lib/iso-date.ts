// The one check for a YYYY-MM-DD date coming from a request. Pure.
//
// The regex alone lets "2026-02-30" through, and Date.UTC then silently rolls
// it over to 2026-03-02: the answer would be about the wrong day. So the date
// must also survive a round trip: the y-m-d read back from Date.UTC must be
// the y-m-d that was sent.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD (2028-02-29 yes, 2026-02-29 no). */
export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Whether `s` has the YYYY-MM-DD shape, real date or not. */
export function looksLikeIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO_DATE.test(s);
}

/** The error text of lib/schedule.ts for a date it cannot use (unchanged wording). */
export const invalidDateError = (s: unknown): string => `date invalide : ${String(s)} (YYYY-MM-DD attendu)`;
