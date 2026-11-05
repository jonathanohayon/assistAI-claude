// Calendar → client_visits sync (loyalty v1) — SERVER-ONLY.
//
// First run per tenant (users.visits_synced_at null) = backfill: bookings of
// the last 12 months + next 90 days. Later runs are incremental: only events
// changed since the cursor (Google `updatedMin` + showDeleted, so
// cancellations come through). Idempotent: upsert on (user_id, event_id).

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientVisits, users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { visitChangeFromEvent, type CalendarEventLike } from "@/lib/loyalty";

const DAY = 24 * 3600 * 1000;
const BACKFILL_PAST_MS = 365 * DAY;
const BACKFILL_FUTURE_MS = 90 * DAY;
const MAX_PAGES = 20; // 20 × 250 events: plenty for one salon-year
const CURSOR_OVERLAP_MS = 5 * 60 * 1000; // clock skew between us and Google

export interface VisitSyncResult {
  ok: boolean;
  mode: "backfill" | "incremental" | "skipped";
  reason?: string;
  scanned: number;
  upserted: number;
  cancelled: number;
}

export async function syncClientVisits(userId: string): Promise<VisitSyncResult> {
  const result: VisitSyncResult = { ok: false, mode: "skipped", scanned: 0, upserted: 0, cancelled: 0 };
  const google = await getTenantGoogleClients(userId);
  if (!google) {
    result.reason = "no_google_credentials";
    return result;
  }
  const [me] = await db
    .select({ visitsSyncedAt: users.visitsSyncedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const startedAt = new Date();
  const cursor = me?.visitsSyncedAt ?? null;
  result.mode = cursor ? "incremental" : "backfill";

  const base = cursor
    ? { updatedMin: new Date(cursor.getTime() - CURSOR_OVERLAP_MS).toISOString(), showDeleted: true }
    : {
        timeMin: new Date(startedAt.getTime() - BACKFILL_PAST_MS).toISOString(),
        timeMax: new Date(startedAt.getTime() + BACKFILL_FUTURE_MS).toISOString(),
      };

  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let items: CalendarEventLike[];
    try {
      const res = await google.calendar.events.list({
        calendarId: google.calendarId,
        singleEvents: true,
        maxResults: 250,
        pageToken,
        ...base,
      });
      items = (res.data.items ?? []) as CalendarEventLike[];
      pageToken = res.data.nextPageToken ?? undefined;
    } catch (e) {
      // Cursor left untouched → the next run retries the same window.
      result.reason = `calendar_fetch_failed: ${(e as Error).message}`;
      return result;
    }
    result.scanned += items.length;
    for (const ev of items) {
      const change = visitChangeFromEvent(ev);
      if (!change) continue;
      if (change.kind === "cancel") {
        const done = await db
          .update(clientVisits)
          .set({ cancelled: true, updatedAt: sql`now()` })
          .where(and(eq(clientVisits.userId, userId), eq(clientVisits.eventId, change.eventId)))
          .returning({ id: clientVisits.id });
        result.cancelled += done.length;
        continue;
      }
      await db
        .insert(clientVisits)
        .values({
          userId,
          eventId: change.eventId,
          clientPhone: change.clientPhone,
          clientName: change.clientName,
          startsAt: change.startsAt,
        })
        .onConflictDoUpdate({
          target: [clientVisits.userId, clientVisits.eventId],
          set: {
            clientPhone: change.clientPhone,
            clientName: change.clientName,
            startsAt: change.startsAt,
            cancelled: false,
            updatedAt: sql`now()`,
          },
        });
      result.upserted++;
    }
    if (!pageToken) break;
  }

  await db.update(users).set({ visitsSyncedAt: startedAt }).where(eq(users.id, userId));
  result.ok = true;
  return result;
}
