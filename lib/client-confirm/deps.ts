// Real wiring of lib/client-confirm/run.ts — SERVER-ONLY.

import { sql } from "drizzle-orm";

import { TOOL_EVENTS, type JoinEvent } from "@/lib/calls/core";
import { loadEventsFor } from "@/lib/calls/query";
import type { ClientConfirmDeps } from "@/lib/client-confirm/run";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import { normalizeE164 } from "@/lib/phone-utils";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import { sendWhatsApp } from "@/lib/whatsapp";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] }).rows ?? [])) as Row[];

export const clientConfirmDeps: ClientConfirmDeps = {
  // The Calls page's join (THE JOIN RULE): stamped events of this call's
  // keys, or unstamped ones in its time span for an old worker's row.
  loadToolEvents: async (userId, call) => (await loadEventsFor(userId, [call], TOOL_EVENTS)).get(call.id) ?? [],
  lastEventOfAppointment: async (userId, eventId, before) => {
    const res = await db.execute(sql`
      SELECT id, user_id, event, created_at, metadata FROM events
      WHERE user_id = ${userId}
        AND event IN ('book_success', 'reschedule_success')
        AND metadata ? 'eventId' AND (metadata->>'eventId') = ${eventId}
        AND created_at <= ${before.toISOString()}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const r = rowsOf(res)[0];
    if (!r) return null;
    const e: JoinEvent = {
      id: String(r.id),
      userId: r.user_id == null ? null : String(r.user_id),
      event: String(r.event),
      createdAt: new Date(r.created_at as string),
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
    };
    return e;
  },
  consumeRateLimit,
  sendWhatsApp,
  logEvent,
  normalizeE164,
};
