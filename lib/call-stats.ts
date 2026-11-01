// Shared call metrics for the dashboard home (and anything else that needs
// "how long was this call").
//
// calls.duration_seconds was 0 on every row until the worker started sending
// it (assistAI-claude-agent#13). Rows with a real duration use it; older rows
// fall back to the historical estimate (6 s per transcript bubble), so the
// numbers don't collapse to zero for past months.

import { sql } from "drizzle-orm";

import { calls } from "@/lib/db/schema";

export const ESTIMATED_SECONDS_PER_BUBBLE = 6;

/** Per-row call seconds: real duration when recorded, else the estimate. */
export const callSecondsSql = sql<number>`(case when ${calls.durationSeconds} > 0 then ${calls.durationSeconds} else jsonb_array_length(${calls.transcript}) * ${ESTIMATED_SECONDS_PER_BUBBLE} end)`;

/** "—" for no data, else "4m05". */
export function formatAvgDuration(avgSeconds: number): string {
  const s = Math.round(avgSeconds);
  if (!Number.isFinite(s) || s <= 0) return "—";
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}`;
}

/** Share of calls that ended in a booking, 0–100. */
export function bookingRate(bookings: number, calls: number): number {
  if (calls <= 0) return 0;
  return Math.min(100, Math.round((bookings / calls) * 100));
}
