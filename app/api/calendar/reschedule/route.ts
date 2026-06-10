import { NextRequest, NextResponse } from "next/server";
import { computeFreeSlots, findConflicts } from "@/lib/calendar-conflict";
import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { type Center, nextDatesForCenter, validateBooking } from "@/lib/schedule";
import { JERUSALEM_TZ, addMinutesJerusalem, jerusalemToUTCISO } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { eventId, newDate, newTime, duration, center } = await req.json();

  if (!eventId || !newDate || !newTime) {
    return NextResponse.json(
      { error: "eventId, newDate et newTime requis" },
      { status: 400 },
    );
  }

  // Center/day rule — identical to book. Reject moving a RDV onto a day whose
  // centre doesn't match the one requested (center is optional ; null = just
  // compute the canonical centre for newDate). validateBooking throws on a
  // malformed date.
  let resolved;
  try {
    resolved = validateBooking(newDate, (center as Center | undefined) ?? null);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!resolved.ok) {
    const suggested = nextDatesForCenter(center as Center, 3, newDate);
    await logEvent({
      source: "calendar",
      event: "reschedule_wrong_center",
      message: `Déplacement refusé : ${resolved.reason}`,
      level: "warn",
      metadata: {
        eventId,
        newDate,
        newTime,
        requestedCenter: center,
        expectedCenter: resolved.expectedCenter,
      },
    });
    return NextResponse.json(
      {
        error: "wrong_day_for_center",
        message: resolved.reason,
        expectedCenter: resolved.expectedCenter,
        expectedLabel: resolved.expectedLabel,
        suggested_dates: suggested,
      },
      { status: 400 },
    );
  }

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

    // Keep the centre label correct when the move crosses centres (e.g. a
    // Jerusalem-Tuesday RDV moved to a Monday becomes Ashdod). Parse the client
    // name out of "RDV {label} — {name}"; leave the summary untouched if it
    // doesn't follow that shape (custom titles, manual events).
    const oldSummary = existing.data.summary ?? "";
    const nameMatch = oldSummary.match(/^RDV .+? — (.+)$/);
    const newSummaryField = nameMatch
      ? `RDV ${resolved.label} — ${nameMatch[1]}`
      : undefined;

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
      message: `RDV déplacé : ${newDate} ${newTime} · ${resolved.label}`,
      metadata: {
        eventId,
        newDate,
        newTime,
        durationMin,
        center: resolved.center,
      },
    });

    return NextResponse.json({
      success: true,
      eventId: updated.data.id,
      center: resolved.center,
      summary: `RDV déplacé au ${newDate} à ${newTime} (${resolved.label}).`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur reschedule";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
