import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { datedEntry, noteIgnoredCenter, oldWorkerLabel, resolvePlace } from "@/lib/booking-place";
import {
  LIST_DATES_HORIZON_DAYS,
  LIST_DATES_MAX,
  LIST_DATES_MIN,
  addDaysIso,
  datesWithFreeSlots,
} from "@/lib/calendar-conflict";
import { AGENT_CALLER_UNAUTHORIZED_BODY, resolveAgentCallerGoogle } from "@/lib/google";
import { invalidDateError, isRealIsoDate, looksLikeIsoDate } from "@/lib/iso-date";
import { jerusalemDateOffset } from "@/lib/tz";

// The next `count` dates (1–10, default 3) that have at least one free slot
// for a `duration`-minute service (default 30) in the TENANT's calendar: the
// same slot logic as /api/calendar/availability (lib/calendar-conflict.ts),
// within LIST_DATES_HORIZON_DAYS (30) days, in one Google read. The agent
// calls this instead of computing "next Tuesday" itself.
//
// Both request shapes are handled the same way (lib/booking-place.ts):
// `location` (string | null) is echoed; a legacy `center` key is ignored, and
// a missing or unknown one is not an error. There is no weekday rule. An
// old-worker body (no `location` key) also gets `label` ("l'établissement")
// and a French `weekday` on each date, which that worker's texts read.
//
// Auth: the INTERNAL_SECRET gate (the worker only), then the tenant routing
// headers, like the other calendar routes.
//
// `after` (YYYY-MM-DD, optional) is INCLUSIVE: when that date itself has a free
// slot it is the first entry of `dates`. The agent passes the day the caller
// asked about ("is tomorrow open?"). When `after` is given the response also
// carries
//   requested_date:      the `after` date, echoed
//   requested_date_open: whether that date has a free slot
// Without `after` the search starts tomorrow (today is never listed) and
// neither key is present. An `after` that is not YYYY-MM-DD is ignored (as
// absent); YYYY-MM-DD but not a real date (2026-02-30) is a 400.
export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  const placed = resolvePlace(body);
  noteIgnoredCenter("list-dates", placed);
  const { count, after, duration } = body as { count?: unknown; after?: unknown; duration?: unknown };

  const n = Math.max(LIST_DATES_MIN, Math.min(LIST_DATES_MAX, Number(count) || 3));
  const durationMin =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;
  const afterDate = looksLikeIsoDate(after) ? after : undefined;
  if (afterDate !== undefined && !isRealIsoDate(afterDate)) {
    return NextResponse.json({ error: invalidDateError(afterDate) }, { status: 400 });
  }

  const caller = await resolveAgentCallerGoogle(req);
  if (caller.mode === "anonymous") {
    // Unreachable behind the gate above; kept so no path can use a client.
    return NextResponse.json(AGENT_CALLER_UNAUTHORIZED_BODY, { status: 401 });
  }
  if (caller.mode === "user_no_google") {
    return NextResponse.json(
      { error: "Google Calendar non connecté pour ce compte." },
      { status: 409 },
    );
  }
  if (caller.mode === "unknown_tenant") {
    return NextResponse.json(
      { error: `Tenant inconnu pour ${caller.dialedPhone || "(numéro absent)"}` },
      { status: 404 },
    );
  }

  const first = afterDate ?? jerusalemDateOffset(1);
  const days = Array.from({ length: LIST_DATES_HORIZON_DAYS }, (_, i) => addDaysIso(first, i));
  try {
    const found = await datesWithFreeSlots(caller.calendar, caller.calendarId, days, durationMin, n);
    return NextResponse.json({
      location: placed.place.label,
      // Old-worker body only: the neutral label and the day names its texts
      // interpolate (lib/booking-place.ts OLD_WORKER_LABEL).
      ...oldWorkerLabel(placed),
      dates: found.map((date) => datedEntry(placed, date)),
      ...(afterDate !== undefined
        ? { requested_date: afterDate, requested_date_open: found[0] === afterDate }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
