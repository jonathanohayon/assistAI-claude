// One tenant's J-1 reminder run, used by /api/cron/appointment-reminders.
// Every side effect (calendar read, idempotence lookup, rate limit, WhatsApp
// send, insert, log) is injected, so the logic is unit-tested without Google,
// Twilio or a database (scripts/tests/appointment-reminders-cap.test.ts).
//
// Caps: at most REMINDERS_PER_TENANT_PER_DAY reminders per tenant and
// REMINDERS_GLOBAL_PER_DAY across tenants, via the shared limiter
// (lib/rate-limit-db.ts, bucket "appointment_reminders"). An event over the
// cap is neither sent nor recorded in appointment_reminders, so it is not
// treated as done. One counts-only `reminders_capped` event per tenant.
//
// Order: earliest appointment first. Dedup: one reminder per destination
// number per day (the earliest event wins; later events for a number that
// already got a reminder are skipped, not recorded).

import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import {
  type ReminderLang,
  formatDateLabel,
  parseEventContact,
  reminderText,
  resolveReminderTemplateSid,
} from "@/lib/reminders";
import { JERUSALEM_TZ } from "@/lib/tz";
import { withCallUsLine } from "@/lib/whatsapp-call-line";

export const REMINDERS_RATE_BUCKET = "appointment_reminders";
export const REMINDERS_PER_TENANT_PER_DAY = 100;
export const REMINDERS_GLOBAL_PER_DAY = 2000;
// The cron runs once a day at about the same time. A full 24 h rolling window
// would still hold the tail of yesterday's run when today's run starts a few
// seconds "early", eating today's quota; 23 h keeps it to one run per window.
export const REMINDERS_CAP_WINDOW_MS = 23 * 60 * 60 * 1000;

export interface ReminderCalendarEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null } | null;
}

export interface ReminderSendResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

export interface ReminderLogEvent {
  source: "whatsapp" | "calendar";
  event: string;
  message: string;
  level?: "info" | "warn" | "error";
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface ReminderDeps {
  /** Tomorrow's events (Google Calendar list, orderBy startTime). */
  listEvents(): Promise<ReminderCalendarEvent[]>;
  /** appointment_reminders rows already stored for these event ids. */
  alreadyReminded(eventIds: string[]): Promise<Array<{ eventId: string; clientPhone: string; status: string }>>;
  callNumber(): Promise<string | null>;
  /** One attempt against the shared limiter; ok = counted. */
  consume(): Promise<RateLimitResult>;
  send(opts: {
    to: string;
    body: string;
    templateSid: string | undefined;
    templateVariables: Record<string, string> | undefined;
  }): Promise<ReminderSendResult>;
  record(row: {
    eventId: string;
    status: "sent" | "failed";
    clientPhone: string;
    error: string;
    appointmentStart: Date | null;
  }): Promise<void>;
  log(ev: ReminderLogEvent): Promise<void>;
}

export interface TenantReminderCounts {
  events: number;
  sent: number;
  failed: number;
  skipped: number; // includes `capped` and `deduped`
  capped: number;
  deduped: number;
}

const startMs = (e: ReminderCalendarEvent) => {
  const t = Date.parse(e.start?.dateTime ?? "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

export async function remindTenant(
  tenant: { id: string; primaryLanguage: string },
  tomorrow: string,
  deps: ReminderDeps,
): Promise<TenantReminderCounts> {
  const counts: TenantReminderCounts = { events: 0, sent: 0, failed: 0, skipped: 0, capped: 0, deduped: 0 };

  const items = (await deps.listEvents())
    .filter((e) => e.id && e.start?.dateTime) // ignore all-day / no id
    // Earliest appointment first (Array.prototype.sort is stable: the
    // calendar's own startTime order is kept for equal starts).
    .sort((a, b) => startMs(a) - startMs(b));
  counts.events = items.length;

  // Idempotence: event ids already reminded for this tenant. Numbers that
  // already got a reminder for tomorrow are not reminded again.
  const ids = items.map((e) => e.id as string);
  const rows = ids.length ? await deps.alreadyReminded(ids) : [];
  const already = new Set(rows.map((r) => r.eventId));
  const remindedNumbers = new Set(rows.filter((r) => r.status === "sent" && r.clientPhone).map((r) => r.clientPhone));

  const lang = (["fr", "he", "en"].includes(tenant.primaryLanguage) ? tenant.primaryLanguage : "fr") as ReminderLang;
  const templateSid = resolveReminderTemplateSid(lang);
  // Tenant's aitamara number for the "call us" line (none → no line).
  const callNumber = await deps.callNumber();

  let cappedScope: "account" | "global" | null = null;

  for (const ev of items) {
    const eventId = ev.id as string;
    if (already.has(eventId)) {
      counts.skipped++;
      continue;
    }
    const { name, phone, center } = parseEventContact({
      summary: ev.summary,
      description: ev.description,
    });
    if (!phone) {
      counts.skipped++;
      continue; // no usable phone → cannot remind
    }
    if (remindedNumbers.has(phone)) {
      counts.skipped++;
      counts.deduped++;
      continue; // this number already gets (or got) a reminder for tomorrow
    }

    if (cappedScope === null) {
      const rl = await deps.consume();
      if (!rl.ok) cappedScope = rl.scope;
    }
    if (cappedScope !== null) {
      counts.skipped++;
      counts.capped++;
      continue; // over the cap: not sent, not recorded
    }
    remindedNumbers.add(phone);

    const startISO = ev.start?.dateTime ?? null;
    const time = startISO
      ? new Intl.DateTimeFormat("fr-FR", {
          timeZone: JERUSALEM_TZ,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(startISO))
      : "";
    const text = withCallUsLine(
      reminderText(lang, {
        name,
        dateLabel: formatDateLabel(tomorrow, lang),
        time,
        center,
      }),
      lang,
      callNumber,
    );

    const r = await deps.send({
      to: phone,
      body: text,
      templateSid,
      templateVariables: templateSid ? { "1": text } : undefined,
    });

    await deps.record({
      eventId,
      status: r.ok ? "sent" : "failed",
      clientPhone: phone,
      error: r.ok ? "" : (r.error ?? "").slice(0, 500),
      appointmentStart: startISO ? new Date(startISO) : null,
    });

    if (r.ok) {
      counts.sent++;
      await deps.log({
        source: "whatsapp",
        event: "appointment_reminder_sent",
        message: `Rappel J-1 → ${phone} (${tomorrow} ${time})`,
        userId: tenant.id,
        metadata: { eventId, phone, sid: r.sid },
      });
    } else {
      counts.failed++;
      await deps.log({
        source: "whatsapp",
        event: "appointment_reminder_failed",
        message: `Rappel J-1 KO → ${phone} : ${(r.error ?? "").slice(0, 150)}`,
        level: "warn",
        userId: tenant.id,
        metadata: { eventId, phone, error: r.error },
      });
    }
  }

  if (cappedScope !== null) {
    // Counts only: no number, name, event id or event text.
    await deps.log({
      source: "whatsapp",
      event: "reminders_capped",
      message: `Appointment reminders capped (${cappedScope}): ${counts.sent + counts.failed} sent, ${counts.capped} skipped`,
      level: "warn",
      userId: tenant.id,
      metadata: { sent: counts.sent + counts.failed, skipped: counts.capped, scope: cappedScope },
    });
  }

  return counts;
}
