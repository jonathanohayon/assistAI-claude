// The trial e-mails sent by the trial-cleanup cron (the warning before the end,
// the "Tamara is paused" e-mail at the end): the switch, the real remaining
// days and the guard every send passes. Pure: no DB, no network.

import { JERUSALEM_TZ } from "@/lib/tz";

/**
 * TRIAL_END_EMAIL = off | on. Exactly "on" switches it on; unset, empty or
 * anything else ("ON", " on", "true", "1") is off. Off means the cron behaves
 * as before: no pause for minutes exhausted, no end-of-trial e-mail.
 */
export type TrialEndEmailSwitch = "on" | "off";
export function parseTrialEndEmailSwitch(raw: string | null | undefined): TrialEndEmailSwitch {
  return raw === "on" ? "on" : "off";
}

/**
 * The time zone the warning counts days in. Accounts have no time zone of
 * their own (users has none, locale is a language), so this is
 * Asia/Jerusalem, as the other crons (owner digest, reminders) use.
 */
export const TRIAL_WARNING_TIME_ZONE = JERUSALEM_TZ;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local calendar day of `d` in `timeZone`, as a day number (UTC days since epoch). */
function localDayNumber(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS);
}

/**
 * The `{warningDays}` of the warning e-mail: the whole local days left before
 * the trial ends, counted from local midnight to local midnight in `timeZone`.
 *   - 0 = it ends before the next local midnight (today);
 *   - 1 = it ends tomorrow (local), 2 = the day after;
 *   - null = it has already ended: no warning (the paused e-mail covers it).
 * The cron sends the warning at most 2 days (48 h) before the end, so the
 * value is always 0, 1 or 2, whatever the hour the cron runs (late runs
 * included).
 */
export function trialWarningDays(
  trialEndsAt: Date,
  now: Date,
  timeZone: string = TRIAL_WARNING_TIME_ZONE,
): number | null {
  if (trialEndsAt.getTime() <= now.getTime()) return null;
  return Math.max(0, localDayNumber(trialEndsAt, timeZone) - localDayNumber(now, timeZone));
}

/**
 * The last guard before any trial e-mail (warning or paused): never to an
 * account that has a PAID payment order (any kind, legacy or multi-line),
 * never to an admin. The selection queries already exclude both; this runs on
 * a fresh read right before the send, so an order paid in between still wins.
 */
export function mayEmailTrialAccount(args: { hasPaidOrder: boolean; role: string | null }): boolean {
  return !args.hasPaidOrder && args.role !== "admin";
}

/**
 * The error CLASS of a failed send, for logs: never the message (a provider
 * error can quote the recipient). A thrown error -> its name ("TypeError");
 * a Resend error string "validation_error: ..." -> "validation_error"; any
 * other string -> "unknown" (it could start with an address).
 */
export function sendErrorClass(err: unknown): string {
  const CLASS = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
  if (err instanceof Error) return CLASS.test(err.name) ? err.name : "unknown";
  if (typeof err !== "string") return "unknown";
  const m = /^([A-Za-z][A-Za-z0-9_]{0,39}):/.exec(err.trim());
  return m ? m[1] : "unknown";
}
