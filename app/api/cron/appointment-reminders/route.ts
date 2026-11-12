import { tenantCallNumber } from "@/lib/tenant-call-number";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, appointmentReminders, users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import {
  REMINDERS_CAP_WINDOW_MS,
  REMINDERS_GLOBAL_PER_DAY,
  REMINDERS_PER_TENANT_PER_DAY,
  REMINDERS_RATE_BUCKET,
  remindTenant,
} from "@/lib/appointment-reminders-run";
import { JERUSALEM_TZ, jerusalemDateOffset, jerusalemToUTCISO } from "@/lib/tz";
import { sendWhatsApp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron J-1 : pour chaque tenant qui a activé le rappel ET connecté Google,
// lit les RDV de DEMAIN (Asia/Jerusalem) dans son agenda et envoie un rappel
// WhatsApp au client. Idempotent via la table appointment_reminders
// (un seul rappel par (tenant, eventId)). Best-effort par tenant/RDV.
//
// Capped per tenant and globally per day (lib/appointment-reminders-run.ts).
//
// Auth : INTERNAL_SECRET. À hooker sur un cron Railway quotidien (~18h Israël,
// soit 15h/16h UTC selon DST).

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

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
    capped?: number;
    reason?: string;
  }> = [];

  for (const t of tenants) {
    let events = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let capped = 0;
    let reason: string | undefined;
    try {
      const g = await getTenantGoogleClients(t.id);
      if (!g) {
        results.push({ userId: t.id, email: t.email, events: 0, sent: 0, failed: 0, skipped: 0, reason: "no_google" });
        continue;
      }

      const counts = await remindTenant(t, tomorrow, {
        listEvents: async () =>
          (
            await g.calendar.events.list({
              calendarId: g.calendarId,
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: "startTime",
              maxResults: 250,
              timeZone: JERUSALEM_TZ,
            })
          ).data.items ?? [],
        alreadyReminded: (ids) =>
          db
            .select({
              eventId: appointmentReminders.eventId,
              clientPhone: appointmentReminders.clientPhone,
              status: appointmentReminders.status,
            })
            .from(appointmentReminders)
            .where(
              and(
                eq(appointmentReminders.userId, t.id),
                inArray(appointmentReminders.eventId, ids),
              ),
            ),
        callNumber: () => tenantCallNumber(t.id),
        consume: () =>
          consumeRateLimit({
            bucket: REMINDERS_RATE_BUCKET,
            accountId: t.id,
            windowMs: REMINDERS_CAP_WINDOW_MS,
            perAccount: REMINDERS_PER_TENANT_PER_DAY,
            global: REMINDERS_GLOBAL_PER_DAY,
          }),
        send: (opts) => sendWhatsApp(opts),
        record: async (row) => {
          await db
            .insert(appointmentReminders)
            .values({ userId: t.id, channel: "whatsapp", ...row })
            .onConflictDoNothing();
        },
        log: (ev) => logEvent(ev),
      });
      events = counts.events;
      sent = counts.sent;
      failed = counts.failed;
      skipped = counts.skipped;
      capped = counts.capped;
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
    results.push({
      userId: t.id,
      email: t.email,
      events,
      sent,
      failed,
      skipped,
      ...(capped ? { capped } : {}),
      reason,
    });
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
