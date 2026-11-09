// Call type at call end — SERVER-ONLY: reads the tenant's tool events of the
// call's time span, then lib/call-type.ts decides.
//
// Events carry no call id, so a call's events are the tenant's tool events
// between its start (end - duration - slack) and its end. Two simultaneous
// calls on the same tenant could share events; rare for one salon line, and
// the result is still a real action of that tenant's agent.

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { resolveCallType, type CallType } from "@/lib/call-type";

export const CALL_TOOL_EVENTS = ["book_success", "cancel_success", "reschedule_success", "call_transfer"];
const SLACK_MS = 30_000;

export async function callTypeForCall(opts: {
  userId: string;
  endedAt: Date;
  durationSeconds: number;
  summary: string;
  transcript: string[];
}): Promise<CallType> {
  let toolEvents: Array<{ event: string; metadata: Record<string, unknown> | null }> = [];
  try {
    const start = new Date(opts.endedAt.getTime() - opts.durationSeconds * 1000 - SLACK_MS);
    const end = new Date(opts.endedAt.getTime() + 5_000);
    toolEvents = await db
      .select({ event: events.event, metadata: events.metadata })
      .from(events)
      .where(
        and(
          eq(events.userId, opts.userId),
          inArray(events.event, CALL_TOOL_EVENTS),
          gte(events.createdAt, start),
          lte(events.createdAt, end),
        ),
      );
  } catch {
    // keyword fallback below
  }
  return resolveCallType(toolEvents, opts.summary, opts.transcript);
}
