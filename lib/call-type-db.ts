// Call type at call end — SERVER-ONLY: reads the tenant's tool events of the
// call's time span, then lib/call-type.ts decides.
//
// With a call id (current workers: LiveKit room name on every request, see
// lib/call-id.ts) a call's events are exactly those stamped with its id —
// overlapping calls on a busy line stay separate. Without one (older
// workers), fall back to the tenant's tool events in the call's time span
// (end - duration - slack … end).

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { resolveCallType, type CallType } from "@/lib/call-type";

export const CALL_TOOL_EVENTS = ["book_success", "cancel_success", "reschedule_success", "call_transfer"];
const SLACK_MS = 30_000;

export async function callTypeForCall(opts: {
  userId: string;
  endedAt: Date;
  callId?: string | null;
  durationSeconds: number;
  summary: string;
  transcript: string[];
}): Promise<CallType> {
  let toolEvents: Array<{ event: string; metadata: Record<string, unknown> | null }> = [];
  try {
    const byWindow = () => {
      const start = new Date(opts.endedAt.getTime() - opts.durationSeconds * 1000 - SLACK_MS);
      const end = new Date(opts.endedAt.getTime() + 5_000);
      return and(gte(events.createdAt, start), lte(events.createdAt, end));
    };
    toolEvents = await db
      .select({ event: events.event, metadata: events.metadata })
      .from(events)
      .where(
        and(
          eq(events.userId, opts.userId),
          inArray(events.event, CALL_TOOL_EVENTS),
          // A call id is authoritative: no time-span guess, so another
          // overlapping call's tool events can never leak in.
          opts.callId
            ? sql`${events.metadata} ? 'callId' AND (${events.metadata}->>'callId') = ${opts.callId}`
            : byWindow(),
        ),
      );
  } catch {
    // keyword fallback below
  }
  return resolveCallType(toolEvents, opts.summary, opts.transcript);
}
