import { NextRequest, NextResponse } from "next/server";

import { computeFreeSlots } from "@/lib/calendar-conflict";
import { resolveAgentCallerGoogle } from "@/lib/google";
import {
  type Center,
  centerForDate,
  dayNameFr,
  labelFor,
  nextDatesForCenter,
} from "@/lib/schedule";

export async function POST(req: NextRequest) {
  const { date, center, duration } = await req.json();
  // Slots must fit the requested service length, not a fixed 30 min.
  const durationMin =
    Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30;

  if (!date) {
    return NextResponse.json(
      { error: "date requise (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  // Compute the unique centre open that day. If the agent asked for a
  // specific centre, refuse to look up availability there if the day says
  // otherwise — saves a Google round-trip and forces the LLM to suggest
  // the right one.
  let allowedCenter: Center;
  try {
    allowedCenter = centerForDate(date);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  if (center && center !== allowedCenter) {
    // The agent asked for a center that isn't open this day. Don't just say
    // no — return the next valid dates for THE CENTER THE CALLER WANTED so
    // the agent can directly propose them ("Jérusalem est fermé lundi, mais
    // mardi 12 ça marche"). Eliminates a re-derivation step on the LLM.
    const suggested = nextDatesForCenter(center as Center, 3, date);
    return NextResponse.json({
      error: "wrong_day_for_center",
      date,
      weekday: dayNameFr(date),
      requested_center: center,
      open_center_that_day: allowedCenter,
      open_label_that_day: labelFor(allowedCenter),
      suggested_dates: suggested,
      message: `Le ${date} (${dayNameFr(date)}), seul ${labelFor(allowedCenter)} est ouvert. Prochaines dates pour ${labelFor(center as Center)} : ${suggested.map((d) => `${d.weekday} ${d.date}`).join(", ")}.`,
    });
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
    // Slot generation + overlap is centralised so book/availability agree and
    // the full service duration is respected (not a hardcoded 30-min window).
    const slots = await computeFreeSlots(
      caller.calendar,
      caller.calendarId,
      date,
      durationMin,
    );

    const suggested = slots.length === 0
      ? nextDatesForCenter(allowedCenter, 3, date)
      : [];
    return NextResponse.json({
      date,
      center: allowedCenter,
      label: labelFor(allowedCenter),
      available_slots: slots,
      ...(slots.length === 0
        ? {
            reason: `Plus de créneau disponible pour le ${date}. Prochaines dates ${labelFor(allowedCenter)} : ${suggested.map((d) => `${d.weekday} ${d.date}`).join(", ")}.`,
            suggested_dates: suggested,
          }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
