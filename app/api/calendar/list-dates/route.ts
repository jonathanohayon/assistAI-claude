import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { looksLikeIsoDate } from "@/lib/iso-date";
import {
  CENTERS,
  type Center,
  centerForDate,
  labelFor,
  nextDatesForCenter,
} from "@/lib/schedule";

// Returns the next N valid dates for a given center per the schedule rules.
// Deterministic, no Google round-trip — the agent calls this instead of
// computing "next Tuesday" itself, eliminating an entire class of LLM
// arithmetic errors.
//
// Auth: same INTERNAL_SECRET gate as the other agent-facing endpoints, so
// only the worker can hit it. No tenant lookup needed (schedule is shared).
//
// `after` (YYYY-MM-DD, optional) is INCLUSIVE: when that date is itself open
// for `center` it is the first entry of `dates`. The agent passes the day the
// caller asked about ("is tomorrow open?"), so that day must be returnable.
// When `after` is given the response also carries
//   requested_date:      the `after` date, echoed
//   requested_date_open: whether `center` is open that day (centerForDate,
//                        the same rule as /api/calendar/availability)
// Without `after` the walk starts tomorrow and neither key is present.
// A malformed `after` is ignored, as before (treated as absent).
export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody<{
    center?: string;
    count?: number;
    after?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const { center, count, after } = parsed.data;

  if (!center || !CENTERS.includes(center as Center)) {
    return NextResponse.json(
      {
        error: `center invalide. Valeurs : ${CENTERS.join(", ")}`,
        valid_centers: CENTERS,
      },
      { status: 400 },
    );
  }

  const n = Math.max(1, Math.min(10, Number(count) || 3));
  // Not YYYY-MM-DD → ignored (from today), as before. YYYY-MM-DD but not a
  // real date (2026-02-30) → nextDatesForCenter throws → 400 below, never
  // rolled over to another day.
  const afterDate = looksLikeIsoDate(after) ? after : undefined;

  try {
    const dates = nextDatesForCenter(center as Center, n, afterDate, {
      inclusive: true,
    });
    return NextResponse.json({
      center,
      label: labelFor(center as Center),
      dates,
      ...(afterDate !== undefined
        ? {
            requested_date: afterDate,
            requested_date_open: centerForDate(afterDate) === center,
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
