// The renewal reminder: ONE email, a few days before a paid period ends,
// because nothing renews by itself (every payment is a manual HYP payment, and
// cron/billing Phase 2 expires every "active" account whose paid_until has
// passed, whatever auto_renew says).
// PURE parts + the runner with every effect INJECTED (no lib/db here: the real
// effects are lib/renewal-reminder-deps.ts), so the switch, the window, the
// "already paid the next period" rule, the dedupe and the copy are tested
// without a database or an email provider.
//
// Rules:
//   - behind RENEWAL_REMINDER_EMAIL = off | on, OFF by default: off, the
//     runner returns before reading anything and the cron response is unchanged;
//   - who: subscription_status "active", paid_until in (now, now + 3 days],
//     not an admin, with an email address, and NOT already paid for the next
//     period (see hasPaidNextPeriod);
//   - once per account per period: a renewal_reminders row (user_id,
//     period_end = paid_until) claimed BEFORE the send; a lost claim = another
//     run sends it. A failed send keeps the claim (never resent);
//   - FAIL-OPEN: any error is caught; the result carries the error CLASS only
//     and the cron's other phases and status are never affected;
//   - no address in events or logs.

import type { LogEvent } from "./logger";
import type { OrderLine } from "./order-lines";
import { JERUSALEM_TZ } from "./tz";

/** How many days before paid_until the reminder goes out. */
export const REMINDER_DAYS_BEFORE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * RENEWAL_REMINDER_EMAIL = off | on. Exactly "on" switches it on; unset,
 * empty or anything else ("ON", " on", "true", "1") is off.
 */
export type RenewalReminderSwitch = "on" | "off";
export function parseRenewalReminderSwitch(raw: string | null | undefined): RenewalReminderSwitch {
  return raw === "on" ? "on" : "off";
}

/** paid_until is in the reminder window: still in the future, at most REMINDER_DAYS_BEFORE days away. */
export function inReminderWindow(paidUntil: Date | null, now: Date): boolean {
  if (!paidUntil) return false;
  const left = paidUntil.getTime() - now.getTime();
  return left > 0 && left <= REMINDER_DAYS_BEFORE * DAY_MS;
}

/**
 * Has the account already paid the period that starts at `paidUntil`?
 *
 * A paid order (legacy or multi-line, lib/order-activation.ts and the legacy
 * callback) always moves users.paid_until to nextPaidUntil = max(paid_until,
 * now) + one period, so an account that paid the next period early has a
 * paid_until a month (or a year) away: it is already outside the window
 * (inReminderWindow). This catches what the window cannot: a PAID multi-line
 * order whose base line records a period starting at/after the current
 * paid_until (periodStart >= paidUntil), i.e. the next period is paid even
 * though this row's paid_until has not moved (yet). Unreadable dates never
 * count as paid.
 */
export function hasPaidNextPeriod(paidUntil: Date, paidOrderLines: readonly (readonly OrderLine[])[]): boolean {
  for (const lines of paidOrderLines) {
    for (const l of lines) {
      if (l.kind !== "base" || !l.periodStart) continue;
      const start = Date.parse(l.periodStart);
      if (Number.isFinite(start) && start >= paidUntil.getTime()) return true;
    }
  }
  return false;
}

export type ReminderAccount = {
  id: string;
  email: string | null;
  role: string | null;
  locale: string | null;
  subscriptionStatus: string | null;
  paidUntil: Date | null;
};

/** Whether this account may get the reminder for its current paid_until, now. */
export function mayRemind(a: ReminderAccount, now: Date): boolean {
  return (
    a.subscriptionStatus === "active" &&
    a.role !== "admin" &&
    typeof a.email === "string" &&
    a.email.trim() !== "" &&
    inReminderWindow(a.paidUntil, now)
  );
}

// ──────────────────────────────────────────────────────────────────────
//   Copy (messages/*.json → Email.renewalReminder)
// ──────────────────────────────────────────────────────────────────────

export type ReminderLocale = "fr" | "he" | "en";
export type ReminderKey = "subject" | "body";
export type ReminderStrings = (key: ReminderKey, vars: { date: string; link: string }) => string;

export function reminderLocale(raw: string | null | undefined): ReminderLocale {
  const short = (raw ?? "").toLowerCase().split("-")[0];
  return short === "he" || short === "en" ? short : "fr";
}

/** The app's public origin: APP_URL, else the production domain. */
export function publicAppOrigin(env: Record<string, string | undefined> = process.env): string {
  const v = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
  return v || "https://aitamara.com";
}

/** The billing page in the account's locale, on the app's public URL. */
export function reminderBillingUrl(locale: ReminderLocale, origin: string): string {
  return `${origin}/${locale}/dashboard/billing`;
}

/** The date the service stops, in the account's language, Israel time (as the other crons). */
export function formatStopDate(paidUntil: Date, locale: ReminderLocale): string {
  const tag = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
  return new Intl.DateTimeFormat(tag, { timeZone: JERUSALEM_TZ, day: "numeric", month: "long", year: "numeric" }).format(paidUntil);
}

export type ReminderInput = { locale: ReminderLocale; paidUntil: Date; link: string };

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderRenewalReminderEmail(input: ReminderInput, t: ReminderStrings): { subject: string; text: string; html: string } {
  const vars = { date: formatStopDate(input.paidUntil, input.locale), link: input.link };
  const subject = t("subject", vars);
  const text = t("body", vars);
  // The link becomes a real anchor; everything else is escaped text.
  const [before, ...rest] = text.split(input.link);
  const after = rest.join(input.link);
  const anchor = `<a href="${escapeHtml(input.link)}" style="color:#be185d;">${escapeHtml(input.link)}</a>`;
  const bodyHtml = rest.length > 0 ? `${escapeHtml(before)}${anchor}${escapeHtml(after)}` : escapeHtml(text);
  const dir = input.locale === "he" ? "rtl" : "ltr";
  const html = `<div dir="${dir}" lang="${input.locale}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;text-align:${dir === "rtl" ? "right" : "left"};">
  <p style="font-size:14px;line-height:1.6;margin:0;color:#374151;">${bodyHtml}</p>
</div>`;
  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────
//   Runner
// ──────────────────────────────────────────────────────────────────────

export type RenewalReminderDeps = {
  /** The raw RENEWAL_REMINDER_EMAIL value, read at call time. */
  switchValue: () => string | undefined;
  now: () => Date;
  /** The app's public origin for the billing link. */
  origin: () => string;
  /** Candidates: active, paid_until in the window, not admin (the runner re-checks). */
  listCandidates: (now: Date) => Promise<ReminderAccount[]>;
  /** The lines of the account's PAID multi-line orders. */
  paidOrderLines: (userId: string) => Promise<OrderLine[][]>;
  /** A fresh read of the account right before the send (null = gone, e.g. deleted). */
  reread: (userId: string) => Promise<ReminderAccount | null>;
  /** true = this run owns the claim (row inserted); false = already claimed. */
  claim: (c: { userId: string; periodEnd: Date }) => Promise<boolean>;
  send: (to: string, input: ReminderInput) => Promise<{ ok: boolean; error?: string }>;
  logEvent: (e: LogEvent) => Promise<unknown>;
};

export type RenewalRemindersResult = {
  enabled: boolean;
  candidates: number;
  claimed: number;
  sent: number;
  failed: number;
  /** The error CLASS when the phase stopped on an error (fail-open). */
  error?: string;
};

/** The error CLASS of anything thrown: never the message (it can quote an address). */
export function errorClass(err: unknown): string {
  if (err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(err.name)) return err.name;
  return "unknown";
}

/** The class of a failed send's error string ("validation_error: ..." -> "validation_error"). */
function sendErrorClass(error: string | undefined): string {
  const m = /^([A-Za-z][A-Za-z0-9_]{0,39}):/.exec((error ?? "").trim());
  return m ? m[1] : "unknown";
}

async function safeLog(deps: RenewalReminderDeps, e: LogEvent): Promise<void> {
  try {
    await deps.logEvent(e);
  } catch (err) {
    console.error(`[renewal-reminder] event not logged: ${errorClass(err)}`);
  }
}

async function remindOne(deps: RenewalReminderDeps, a: ReminderAccount, now: Date, out: RenewalRemindersResult): Promise<void> {
  if (!mayRemind(a, now) || !a.paidUntil) return;
  if (hasPaidNextPeriod(a.paidUntil, await deps.paidOrderLines(a.id))) return;
  out.candidates++;
  const periodEnd = a.paidUntil;
  if (!(await deps.claim({ userId: a.id, periodEnd }))) return;
  out.claimed++;
  // Fresh read right before the send: a payment, a status change or a
  // deletion in between wins (the claim stays: never resent for this period).
  const fresh = await deps.reread(a.id);
  if (
    !fresh ||
    !mayRemind(fresh, now) ||
    fresh.paidUntil?.getTime() !== periodEnd.getTime() ||
    hasPaidNextPeriod(periodEnd, await deps.paidOrderLines(a.id))
  ) {
    return;
  }
  const locale = reminderLocale(fresh.locale);
  let r: { ok: boolean; error?: string };
  try {
    r = await deps.send(fresh.email as string, { locale, paidUntil: periodEnd, link: reminderBillingUrl(locale, deps.origin()) });
  } catch (err) {
    r = { ok: false, error: `${errorClass(err)}:` };
  }
  if (r.ok) out.sent++;
  else out.failed++;
  await safeLog(deps, {
    source: "email",
    event: r.ok ? "renewal_reminder_sent" : "renewal_reminder_failed",
    message: `Renewal reminder ${r.ok ? "sent" : "not sent"}`,
    level: r.ok ? "info" : "warn",
    userId: a.id,
    metadata: { periodEnd: periodEnd.toISOString(), locale, ...(r.ok ? {} : { errorClass: sendErrorClass(r.error) }) },
  });
}

/** Never throws (fail-open): off = nothing read, { enabled: false }. */
export async function runRenewalReminders(deps: RenewalReminderDeps): Promise<RenewalRemindersResult> {
  const out: RenewalRemindersResult = { enabled: false, candidates: 0, claimed: 0, sent: 0, failed: 0 };
  try {
    if (parseRenewalReminderSwitch(deps.switchValue()) !== "on") return out;
    out.enabled = true;
    const now = deps.now();
    const accounts = await deps.listCandidates(now);
    for (const a of accounts) {
      try {
        await remindOne(deps, a, now, out);
      } catch (err) {
        // One account's error never stops the others.
        out.failed++;
        await safeLog(deps, {
          source: "email",
          event: "renewal_reminder_failed",
          message: "Renewal reminder not sent (error)",
          level: "warn",
          userId: a.id,
          metadata: { errorClass: errorClass(err) },
        });
      }
    }
  } catch (err) {
    out.error = errorClass(err);
    await safeLog(deps, {
      source: "email",
      event: "renewal_reminder_phase_failed",
      message: "Renewal reminder phase stopped on an error",
      level: "warn",
      metadata: { errorClass: out.error },
    });
  }
  return out;
}
