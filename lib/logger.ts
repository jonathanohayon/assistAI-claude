// Structured event logger. Persists to the events table for live display
// in /dashboard/logs. Best-effort: never throws — a logging failure must
// not crash the request that's being logged.
//
// Usage:
//   import { logEvent } from "@/lib/logger";
//   await logEvent({ source: "whatsapp", event: "send_failed", message: "...", level: "error", metadata: { error: msg } });
//
// Source taxonomy:
//   agent     — LiveKit voice worker
//   web       — Next.js API routes / dashboard
//   calendar  — Google Calendar tool calls
//   sheets    — Google Sheets tool calls
//   whatsapp  — WhatsApp dispatch (Meta or Twilio)
//   auth      — login/signup/logout
//   tenant    — multi-tenant resolution
//   summary   — call summarization (gpt-5.4-mini)

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { events, phoneNumbers } from "@/lib/db/schema";

export type LogLevel = "info" | "warn" | "error";
export type LogSource =
  | "agent"
  | "web"
  | "calendar"
  | "sheets"
  | "whatsapp"
  | "auth"
  | "tenant"
  | "summary"
  | "latency"
  | "sync";

export interface LogEvent {
  source: LogSource;
  event: string;
  message: string;
  level?: LogLevel;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logEvent(ev: LogEvent): Promise<void> {
  // Si pas d'userId fourni, on tente de le déduire de la metadata pour
  // éviter les events "orphelins" qui n'apparaissent dans aucun dashboard
  // tenant (cf. /api/dashboard/call-metrics qui filtre par user_id).
  // 2 stratégies :
  //   1. metadata.origin.userId (sessions web Phase 2, déjà set côté worker)
  //   2. metadata.toNumber → phone_numbers.user_id (chemin SIP Twilio)
  let resolvedUserId = ev.userId ?? null;
  if (!resolvedUserId && ev.metadata) {
    // Stratégie 1 : origin.userId pour les sessions web
    const origin = ev.metadata['origin'] as
      | { userId?: string }
      | undefined;
    if (origin?.userId && typeof origin.userId === 'string') {
      resolvedUserId = origin.userId;
    }
    // Stratégie 2 : toNumber → phone_numbers (chemin SIP)
    if (!resolvedUserId) {
      const toNumber = ev.metadata['toNumber'];
      if (typeof toNumber === 'string' && toNumber.length > 0) {
        try {
          const [row] = await db
            .select({ userId: phoneNumbers.userId })
            .from(phoneNumbers)
            .where(eq(phoneNumbers.phoneNumber, toNumber))
            .limit(1);
          if (row?.userId) resolvedUserId = row.userId;
        } catch {
          // best-effort — on tombera sur null + log warn
        }
      }
    }
  }

  try {
    await db.insert(events).values({
      level: ev.level ?? "info",
      source: ev.source,
      event: ev.event,
      message: ev.message,
      userId: resolvedUserId,
      metadata: ev.metadata ?? {},
    });
  } catch (e) {
    // Never bubble — logging must never break a request.
    console.error("[logger] failed:", (e as Error).message);
  }

  // Mirror to stdout so Railway/PM2 logs still capture it for forensics.
  const tag = `[${ev.source}:${ev.event}]`;
  if (ev.level === "error") {
    console.error(tag, ev.message, ev.metadata ?? "");
  } else if (ev.level === "warn") {
    console.warn(tag, ev.message, ev.metadata ?? "");
  } else {
    console.log(tag, ev.message, ev.metadata ?? "");
  }
}
