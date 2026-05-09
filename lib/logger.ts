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

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

export type LogLevel = "info" | "warn" | "error";
export type LogSource =
  | "agent"
  | "web"
  | "calendar"
  | "sheets"
  | "whatsapp"
  | "auth"
  | "tenant"
  | "summary";

export interface LogEvent {
  source: LogSource;
  event: string;
  message: string;
  level?: LogLevel;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logEvent(ev: LogEvent): Promise<void> {
  try {
    await db.insert(events).values({
      level: ev.level ?? "info",
      source: ev.source,
      event: ev.event,
      message: ev.message,
      userId: ev.userId ?? null,
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
