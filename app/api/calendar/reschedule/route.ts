import { NextRequest, NextResponse } from "next/server";
import { resolveAgentCallerGoogle } from "@/lib/google";
import { JERUSALEM_TZ, addMinutesJerusalem } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { eventId, newDate, newTime, duration } = await req.json();

  if (!eventId || !newDate || !newTime) {
    return NextResponse.json(
      { error: "eventId, newDate et newTime requis" },
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

    const endParts = addMinutesJerusalem(newDate, newTime, durationMin);

    const updated = await caller.calendar.events.patch({
      calendarId: caller.calendarId,
      eventId,
      requestBody: {
        start: { dateTime: `${newDate}T${newTime}:00`, timeZone: JERUSALEM_TZ },
        end: {
          dateTime: `${endParts.date}T${endParts.time}:00`,
          timeZone: JERUSALEM_TZ,
        },
      },
    });

    return NextResponse.json({
      success: true,
      eventId: updated.data.id,
      summary: `RDV déplacé au ${newDate} à ${newTime}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur reschedule";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
