import { NextRequest, NextResponse } from "next/server";
import { computeFreeSlots, findConflicts } from "@/lib/calendar-conflict";
import { AGENT_CALLER_UNAUTHORIZED_BODY, requireAgentCaller, resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { callIdMeta } from "@/lib/call-id";
import { eventTitle, nameFromTitle, noteIgnoredCenter, resolvePlace } from "@/lib/booking-place";
import { invalidDateError, isRealIsoDate } from "@/lib/iso-date";
import { JERUSALEM_TZ, addMinutesJerusalem, jerusalemToUTCISO } from "@/lib/tz";

export async function POST(req: NextRequest) {
  // No internal secret and no session → 401 before anything else.
  const gate = await requireAgentCaller(req);
  if (!gate.ok) return gate.response;
  const body = (await req.json()) as Record<string, unknown>;
  const { eventId, newDate, newTime, duration } = body as {
    eventId?: string;
    newDate?: string;
    newTime?: string;
    duration?: number;
  };

  if (!eventId || !newDate || !newTime) {
    return NextResponse.json(
      { error: "eventId, newDate et newTime requis" },
      { status: 400 },
    );
  }

  // Where (lib/booking-place.ts): a `location` from the tenant's own sheet,
  // or none. No weekday rule for either request shape; a legacy `center` key
  // is ignored. A date that does not exist (2026-02-30) is refused.
  if (!isRealIsoDate(newDate)) {
    return NextResponse.json({ error: invalidDateError(newDate) }, { status: 400 });
  }
  const placed = resolvePlace(body);
  noteIgnoredCenter("reschedule", placed);
  const { place } = placed;
  const placeField = { location: place.label };

  // Refuse moving a RDV into the past (5-min grace for clock skew) — same as book.
  try {
    const slotMs = new Date(
      jerusalemToUTCISO(newDate, `${newTime}:00`),
    ).getTime();
    if (slotMs < Date.now() - 5 * 60_000) {
      await logEvent({
        source: "calendar",
        event: "reschedule_past",
        message: `Déplacement refusé : créneau passé (${newDate} ${newTime})`,
        level: "warn",
        metadata: { eventId, newDate, newTime },
      });
      return NextResponse.json(
        {
          error: `Le créneau ${newDate} ${newTime} est déjà passé. Propose un horaire futur.`,
        },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: `Date/heure invalide : ${newDate} ${newTime}` },
      { status: 400 },
    );
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
    const existing = await caller.calendar.events.get({
      calendarId: caller.calendarId,
      eventId,
    });
    const oldStart = existing.data.start?.dateTime
      ? new Date(existing.data.start.dateTime)
      : null;
    const oldEnd = existing.data.end?.dateTime
      ? new Date(existing.data.end.dateTime)
      : null;
    const oldDurationMin =
      oldStart && oldEnd
        ? Math.round((oldEnd.getTime() - oldStart.getTime()) / 60_000)
        : 30;
    const durationMin = duration ?? oldDurationMin;

    // Same deterministic overlap guard as book — but exclude THIS event so a
    // reschedule never reports a conflict against its own current slot.
    const conflicts = await findConflicts(
      caller.calendar,
      caller.calendarId,
      newDate,
      newTime,
      durationMin,
      eventId,
    );
    if (conflicts.length > 0) {
      const slots = await computeFreeSlots(
        caller.calendar,
        caller.calendarId,
        newDate,
        durationMin,
      );
      return NextResponse.json(
        {
          error: "slot_conflict",
          message:
            slots.length > 0
              ? `Le créneau ${newTime} (${durationMin} min) chevauche un rendez-vous existant le ${newDate}. Créneaux libres : ${slots.join(", ")}.`
              : `Le créneau ${newTime} (${durationMin} min) chevauche un rendez-vous existant le ${newDate}.`,
          available_slots: slots,
        },
        { status: 409 },
      );
    }

    const endParts = addMinutesJerusalem(newDate, newTime, durationMin);

    // With a place given, retitle "RDV {place} — {name}" (the client name
    // parsed out of our own title shape; custom / manual titles untouched).
    // With no place, the title is left as it is.
    const oldSummary = existing.data.summary ?? "";
    const clientName = nameFromTitle(oldSummary);
    const newSummaryField = clientName && place.label ? eventTitle(place, clientName) : undefined;

    const updated = await caller.calendar.events.patch({
      calendarId: caller.calendarId,
      eventId,
      requestBody: {
        ...(newSummaryField ? { summary: newSummaryField } : {}),
        start: { dateTime: `${newDate}T${newTime}:00`, timeZone: JERUSALEM_TZ },
        end: {
          dateTime: `${endParts.date}T${endParts.time}:00`,
          timeZone: JERUSALEM_TZ,
        },
      },
    });

    await logEvent({
      source: "calendar",
      event: "reschedule_success",
      message: `RDV déplacé : ${newDate} ${newTime}${place.label ? ` · ${place.label}` : ""}`,
      // Attributed to the tenant (like book_success): the call type and the
      // dashboard read tool events by user_id.
      ...(caller.mode === "tenant" ? { userId: caller.userId } : {}),
      metadata: {
        ...callIdMeta(req),
        eventId,
        newDate,
        newTime,
        durationMin,
        ...placeField,
      },
    });

    return NextResponse.json({
      success: true,
      eventId: updated.data.id,
      ...placeField,
      summary: `RDV déplacé au ${newDate} à ${newTime}${place.label ? ` (${place.label})` : ""}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur reschedule";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
