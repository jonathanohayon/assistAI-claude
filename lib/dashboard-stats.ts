// Home KPIs for one tenant, shared by /dashboard and the admin tenant view
// (/admin/users/[userId]) so both show the same numbers. SERVER-ONLY.

import { and, eq, gte, sql } from "drizzle-orm";

import type { DashboardStats } from "@/app/[locale]/dashboard/config/types";
import { bookingRate, callSecondsSql } from "@/lib/call-stats";
import { db } from "@/lib/db";
import { calls, events } from "@/lib/db/schema";

/**
 * Durations: real calls.duration_seconds when recorded, else the historical
 * 6 s/bubble estimate. Bookings: `book_success` events attributed to the
 * tenant (no longer a keyword regex on the summary, which flagged 212 of 223
 * prod calls). Conversion = bookings ÷ calls. `rdvSince` = first attributed
 * booking, so the UI can say "since <date>": attribution starts at deploy,
 * older bookings can't be tied to a tenant.
 */
export async function computeDashboardStats(userId: string): Promise<DashboardStats> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [[todayRow], [monthRow], [totalRow], [bookingRow]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfToday))),
    db
      .select({ totalSeconds: sql<number>`coalesce(sum(${callSecondsSql}), 0)::int` })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfMonth))),
    db
      .select({
        count: sql<number>`count(*)::int`,
        avgSeconds: sql<number>`coalesce(avg(${callSecondsSql}), 0)::float`,
      })
      .from(calls)
      .where(eq(calls.userId, userId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
        since: sql<string | null>`to_char(min(${events.createdAt}), 'YYYY-MM-DD')`,
      })
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.event, "book_success"))),
  ]);

  const total = totalRow?.count ?? 0;
  const bookings = bookingRow?.count ?? 0;
  return {
    callsToday: todayRow?.count ?? 0,
    conversion: bookingRate(bookings, total),
    avgSeconds: Math.round(totalRow?.avgSeconds ?? 0),
    rdv: bookings,
    rdvSince: bookingRow?.since ?? null,
    minutesThisMonth: Math.round((monthRow?.totalSeconds ?? 0) / 60),
  };
}
