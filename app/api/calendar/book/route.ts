import { NextRequest, NextResponse } from "next/server";

import { computeFreeSlots, findConflicts } from "@/lib/calendar-conflict";
import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { type Center, nextDatesForCenter, validateBooking } from "@/lib/schedule";
import { JERUSALEM_TZ, addMinutesJerusalem, jerusalemToUTCISO } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const {
    name,
    phone,
    email,
    date,
    time,
    duration = 30,
    description,
    center,
  } = await req.json();

  if (!name || !phone || !date || !time) {
    await logEvent({
      source: "calendar",
      event: "book_invalid",
      message: `Réservation refusée — champs manquants`,
      level: "warn",
      metadata: { name, phone, date, time },
    });
    return NextResponse.json(
      { error: "Champs requis manquants (name, phone, date, time)" },
      { status: 400 },
    );
  }

  // Center rules: each day of the week is bound to exactly one centre.
  // Reject if the agent picked a date that doesn't match the requested
  // centre — fixes "book Ashdod on a Tuesday" type bugs.
  let resolved;
  try {
    resolved = validateBooking(date, (center as Center | undefined) ?? null);
  } catch (e) {
    await logEvent({
      source: "calendar",
      event: "book_invalid_date",
      message: `Date invalide : ${date}`,
      level: "warn",
      metadata: { date, error: (e as Error).message },
    });
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  if (!resolved.ok) {
    // Caller booked the wrong center for this date. Hand back the next
    // valid dates FOR THE CENTER THEY ASKED FOR so the agent can re-propose
    // without recomputing anything.
    const suggested = nextDatesForCenter(center as Center, 3, date);
    await logEvent({
      source: "calendar",
      event: "book_wrong_center",
      message: `Réservation refusée : ${resolved.reason}`,
      level: "warn",
      metadata: {
        name,
        phone,
        date,
        time,
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

  // Refuse bookings in the past (with 5-min grace for clock skew). The agent
  // should never propose a passé créneau, but if it does, we block here.
  try {
    const slotMs = new Date(jerusalemToUTCISO(date, `${time}:00`)).getTime();
    if (slotMs < Date.now() - 5 * 60_000) {
      await logEvent({
        source: "calendar",
        event: "book_past",
        message: `Réservation refusée : créneau dans le passé (${date} ${time})`,
        level: "warn",
        metadata: { name, phone, date, time },
      });
      return NextResponse.json(
        {
          error: `Le créneau ${date} ${time} est déjà passé. Propose un horaire futur.`,
        },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: `Date/heure invalide : ${date} ${time}` },
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
  const endParts = addMinutesJerusalem(date, time, duration);

  // Deterministic overlap guard — THE rule that the prompt cannot enforce.
  // Re-check the live calendar with the ACTUAL service duration right before
  // inserting (closes the TOCTOU gap between check_availability and book).
  try {
    const conflicts = await findConflicts(
      caller.calendar,
      caller.calendarId,
      date,
      time,
      duration,
    );
    if (conflicts.length > 0) {
      const slots = await computeFreeSlots(
        caller.calendar,
        caller.calendarId,
        date,
        duration,
      );
      await logEvent({
        source: "calendar",
        event: "book_conflict",
        message: `Réservation refusée : chevauchement (${date} ${time}, ${duration} min)`,
        level: "warn",
        metadata: { name, phone, date, time, duration, conflicts },
      });
      return NextResponse.json(
        {
          error: "slot_conflict",
          message:
            slots.length > 0
              ? `Le créneau ${time} (${duration} min) chevauche un rendez-vous existant le ${date}. Créneaux libres : ${slots.join(", ")}.`
              : `Le créneau ${time} (${duration} min) chevauche un rendez-vous existant et il n'y a plus de place le ${date}.`,
          available_slots: slots,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    // Don't book blind if the conflict check itself fails — surface the error.
    const msg = err instanceof Error ? err.message : "Erreur vérification créneau";
    await logEvent({
      source: "calendar",
      event: "book_conflict_check_failed",
      message: `Vérification créneau échouée : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { name, phone, date, time, duration, error: msg },
    });
    return NextResponse.json(
      { error: `Impossible de vérifier la disponibilité : ${msg}` },
      { status: 502 },
    );
  }

  try {
    const event = await caller.calendar.events.insert({
      calendarId: caller.calendarId,
      requestBody: {
        summary: `RDV ${resolved.label} — ${name}`,
        description: [
          description || "Rendez-vous",
          `Centre : ${resolved.label}`,
          `Tel : ${phone}`,
          email ? `Email : ${email}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        start: { dateTime: `${date}T${time}:00`, timeZone: JERUSALEM_TZ },
        end: {
          dateTime: `${endParts.date}T${endParts.time}:00`,
          timeZone: JERUSALEM_TZ,
        },
      },
    });

    await logEvent({
      source: "calendar",
      event: "book_success",
      message: `RDV créé : ${name} · ${date} ${time} · ${resolved.label}`,
      metadata: {
        eventId: event.data.id,
        name,
        phone,
        date,
        time,
        duration,
        center: resolved.center,
      },
    });

    return NextResponse.json({
      success: true,
      eventId: event.data.id,
      link: event.data.htmlLink,
      center: resolved.center,
      summary: `RDV confirmé le ${date} à ${time} pour ${name} à ${resolved.label}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    await logEvent({
      source: "calendar",
      event: "book_failed",
      message: `Réservation échouée : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { name, phone, date, time, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
