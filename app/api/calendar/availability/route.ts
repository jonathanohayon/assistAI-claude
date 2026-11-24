import { NextRequest, NextResponse } from "next/server";

import { computeFreeSlots } from "@/lib/calendar-conflict";
import { AGENT_CALLER_UNAUTHORIZED_BODY, requireAgentCaller, resolveAgentCallerGoogle } from "@/lib/google";
import { noteIgnoredCenter, resolvePlace } from "@/lib/booking-place";
import { invalidDateError, isRealIsoDate } from "@/lib/iso-date";

export async function POST(req: NextRequest) {
  // No internal secret and no session → 401 before anything else.
  const gate = await requireAgentCaller(req);
  if (!gate.ok) return gate.response;
  const body = (await req.json()) as Record<string, unknown>;
  const { date, duration } = body as { date?: string; duration?: number };
  // The tenant's own place (`location`), or none. No weekday rule, no centre
  // label, for either request shape (lib/booking-place.ts).
  const placed = resolvePlace(body);
  noteIgnoredCenter("availability", placed);
  const location = placed.place.label;
  // Slots must fit the requested service length, not a fixed 30 min.
  const durationMin =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;

  if (!date) {
    return NextResponse.json(
      { error: "date requise (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  // A date that does not exist (2026-02-30) is refused, never rolled over.
  if (!isRealIsoDate(date)) {
    return NextResponse.json({ error: invalidDateError(date) }, { status: 400 });
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

  try {
    // Slot generation + overlap is centralised so book/availability agree and
    // the full service duration is respected (not a hardcoded 30-min window).
    const slots = await computeFreeSlots(
      caller.calendar,
      caller.calendarId,
      date,
      durationMin,
    );

    return NextResponse.json({
      date,
      location,
      available_slots: slots,
      ...(slots.length === 0 ? { reason: `Plus de créneau disponible pour le ${date}.` } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
