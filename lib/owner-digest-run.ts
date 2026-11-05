// Owner's morning WhatsApp digest — SERVER-ONLY runner, called by
// /api/cron/owner-digest once a morning. Idempotent per tenant per day
// (an `owner_digest_sent` event with metadata.day is the ledger), so a
// re-run or a double cron tick never sends twice.

import { and, eq, gte, lt, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, calls, events, users } from "@/lib/db/schema";
import { inferCallType } from "@/lib/call-type";
import { logEvent } from "@/lib/logger";
import {
  formatOwnerDigest,
  shouldSendDigest,
  yesterdayWindow,
  type DigestStats,
} from "@/lib/owner-digest";
import { sendWhatsApp } from "@/lib/whatsapp";

export interface OwnerDigestRunResult {
  day: string;
  tenants: number;
  sent: number;
  skippedNoCalls: number;
  skippedAlreadySent: number;
  failed: number;
}

export async function statsFor(userId: string, start: Date, end: Date): Promise<DigestStats> {
  const callRows = await db
    .select({
      summary: calls.summary,
      transcript: calls.transcript,
      durationSeconds: calls.durationSeconds,
      callType: calls.callType,
    })
    .from(calls)
    .where(and(eq(calls.userId, userId), gte(calls.createdAt, start), lt(calls.createdAt, end)));

  const [ev] = await db
    .select({
      bookings: sql<number>`count(*) FILTER (WHERE ${events.event} = 'book_success')::int`,
      transfers: sql<number>`count(*) FILTER (WHERE ${events.event} = 'call_transfer' AND ${events.metadata}->>'ok' = 'true')::int`,
    })
    .from(events)
    .where(and(eq(events.userId, userId), gte(events.createdAt, start), lt(events.createdAt, end)));

  const seconds = callRows.reduce((n, c) => n + (c.durationSeconds ?? 0), 0);
  // calls.call_type is set at call end (tool events, then keywords); rows
  // from before that column existed fall back to the keyword classifier.
  const messages = callRows.filter(
    (c) =>
      (c.callType ||
        inferCallType(
          c.summary ?? "",
          (Array.isArray(c.transcript) ? c.transcript : []).map((t) => String((t as { text?: unknown }).text ?? "")),
        )) === "Message",
  ).length;
  return {
    calls: callRows.length,
    minutes: Math.ceil(seconds / 60),
    bookings: ev?.bookings ?? 0,
    messages,
    transfers: ev?.transfers ?? 0,
  };
}

async function alreadySent(userId: string, day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.event, "owner_digest_sent"),
        sql`${events.metadata}->>'day' = ${day}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function runOwnerDigests(now = new Date()): Promise<OwnerDigestRunResult> {
  const { day, start, end } = yesterdayWindow(now);
  const tenants = await db
    .select({
      userId: users.id,
      businessName: users.displayName,
      ownerWhatsapp: agentConfigs.ownerWhatsapp,
      language: agentConfigs.primaryLanguage,
    })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(and(eq(agentConfigs.ownerDigestEnabled, true), ne(agentConfigs.ownerWhatsapp, "")));

  const result: OwnerDigestRunResult = {
    day,
    tenants: tenants.length,
    sent: 0,
    skippedNoCalls: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");

  for (const t of tenants) {
    try {
      const stats = await statsFor(t.userId, start, end);
      if (!shouldSendDigest(stats)) {
        result.skippedNoCalls++;
        continue;
      }
      if (await alreadySent(t.userId, day)) {
        result.skippedAlreadySent++;
        continue;
      }
      const language = t.language ?? "fr";
      const body = formatOwnerDigest(language, day, stats, {
        businessName: t.businessName ?? "",
        dashboardUrl: appUrl ? `${appUrl}/dashboard` : undefined,
      });
      // Same delivery as the per-call owner recap: per-language owner
      // template (bypasses the 24 h window), free-form otherwise.
      const template =
        process.env[`WHATSAPP_OWNER_TEMPLATE_SID_${language.toUpperCase()}`] ||
        process.env.WHATSAPP_OWNER_TEMPLATE_SID;
      const r = await sendWhatsApp({
        to: t.ownerWhatsapp,
        body,
        templateSid: template || undefined,
        templateVariables: template ? { "1": body.slice(0, 1000) } : undefined,
        ownerTemplateFallback: true,
      });
      if (r.ok) {
        result.sent++;
        await logEvent({
          source: "whatsapp",
          event: "owner_digest_sent",
          message: `Daily digest sent to the owner (${stats.calls} calls on ${day})`,
          userId: t.userId,
          metadata: { day, ...stats, sid: r.sid },
        });
      } else {
        result.failed++;
        await logEvent({
          source: "whatsapp",
          event: "owner_digest_failed",
          level: "error",
          message: `Daily digest failed: ${r.error?.slice(0, 200)}`,
          userId: t.userId,
          metadata: { day, error: r.error },
        });
      }
    } catch (e) {
      result.failed++;
      console.error("[owner-digest]", t.userId, e);
    }
  }
  return result;
}
