import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { agentConfigs, appointmentReminders, users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import {
  type ReminderLang,
  formatDateLabel,
  parseEventContact,
  reminderText,
  resolveReminderTemplateSid,
} from "@/lib/reminders";
import { JERUSALEM_TZ, jerusalemDateOffset, jerusalemToUTCISO } from "@/lib/tz";
import { sendWhatsApp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron J-1 : pour chaque tenant qui a activé le rappel ET connecté Google,
// lit les RDV de DEMAIN (Asia/Jerusalem) dans son agenda et envoie un rappel
// WhatsApp au client. Idempotent via la table appointment_reminders
// (un seul rappel par (tenant, eventId)). Best-effort par tenant/RDV.
//
// Auth : INTERNAL_SECRET. À hooker sur un cron Railway quotidien (~18h Israël,
// soit 15h/16h UTC selon DST).

export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const tomorrow = jerusalemDateOffset(1);
  const timeMin = jerusalemToUTCISO(tomorrow, "00:00:00");
  const timeMax = jerusalemToUTCISO(tomorrow, "23:59:59");

  // Tenants ayant activé le rappel ET connecté Google.
  const tenants = await db
    .select({
      id: users.id,
      email: users.email,
      primaryLanguage: agentConfigs.primaryLanguage,
    })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(
      and(
        eq(agentConfigs.reminderEnabled, true),
        isNotNull(users.googleRefreshToken),
      ),
    );

  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const results: Array<{
    userId: string;
    email: string;
    events: number;
    sent: number;
    failed: number;
    skipped: number;
    reason?: string;
  }> = [];

  for (const t of tenants) {
    let events = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let reason: string | undefined;
    try {
      const g = await getTenantGoogleClients(t.id);
      if (!g) {
        results.push({ userId: t.id, email: t.email, events: 0, sent: 0, failed: 0, skipped: 0, reason: "no_google" });
        continue;
      }

      const list = await g.calendar.events.list({
        calendarId: g.calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        timeZone: JERUSALEM_TZ,
      });
      const items = (list.data.items ?? []).filter(
        (e) => e.id && e.start?.dateTime, // ignore all-day / sans id
      );
      events = items.length;

      // Idempotence : eventIds déjà rappelés pour ce tenant.
      const ids = items.map((e) => e.id as string);
      const already = ids.length
        ? new Set(
            (
              await db
                .select({ eventId: appointmentReminders.eventId })
                .from(appointmentReminders)
                .where(
                  and(
                    eq(appointmentReminders.userId, t.id),
                    inArray(appointmentReminders.eventId, ids),
                  ),
                )
            ).map((r) => r.eventId),
          )
        : new Set<string>();

      const lang = (["fr", "he", "en"].includes(t.primaryLanguage)
        ? t.primaryLanguage
        : "fr") as ReminderLang;
      const templateSid = resolveReminderTemplateSid(lang);

      for (const ev of items) {
        const eventId = ev.id as string;
        if (already.has(eventId)) {
          skipped++;
          continue;
        }
        const { name, phone, center } = parseEventContact({
          summary: ev.summary,
          description: ev.description,
        });
        if (!phone) {
          skipped++;
          continue; // pas de téléphone exploitable → on ne peut pas rappeler
        }

        const startISO = ev.start?.dateTime ?? null;
        const time = startISO
          ? new Intl.DateTimeFormat("fr-FR", {
              timeZone: JERUSALEM_TZ,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(startISO))
          : "";
        const text = reminderText(lang, {
          name,
          dateLabel: formatDateLabel(tomorrow, lang),
          time,
          center,
        });

        const r = await sendWhatsApp({
          to: phone,
          body: text,
          templateSid,
          templateVariables: templateSid ? { "1": text.slice(0, 1000) } : undefined,
        });

        await db
          .insert(appointmentReminders)
          .values({
            userId: t.id,
            eventId,
            channel: "whatsapp",
            status: r.ok ? "sent" : "failed",
            clientPhone: phone,
            error: r.ok ? "" : (r.error ?? "").slice(0, 500),
            appointmentStart: startISO ? new Date(startISO) : null,
          })
          .onConflictDoNothing();

        if (r.ok) {
          sent++;
          await logEvent({
            source: "whatsapp",
            event: "appointment_reminder_sent",
            message: `Rappel J-1 → ${phone} (${tomorrow} ${time})`,
            userId: t.id,
            metadata: { eventId, phone, sid: r.sid },
          });
        } else {
          failed++;
          await logEvent({
            source: "whatsapp",
            event: "appointment_reminder_failed",
            message: `Rappel J-1 KO → ${phone} : ${(r.error ?? "").slice(0, 150)}`,
            level: "warn",
            userId: t.id,
            metadata: { eventId, phone, error: r.error },
          });
        }
      }
    } catch (e) {
      reason = e instanceof Error ? e.message.slice(0, 200) : "exception";
      await logEvent({
        source: "calendar",
        event: "appointment_reminders_tenant_failed",
        message: `Rappels J-1 crash pour ${t.email} : ${reason}`,
        level: "error",
        userId: t.id,
        metadata: { error: reason },
      });
    }

    totalSent += sent;
    totalFailed += failed;
    totalSkipped += skipped;
    results.push({ userId: t.id, email: t.email, events, sent, failed, skipped, reason });
  }

  return NextResponse.json({
    ok: true,
    date: tomorrow,
    tenants: tenants.length,
    totalSent,
    totalFailed,
    totalSkipped,
    elapsedMs: Date.now() - startedAt,
    results,
  });
}
