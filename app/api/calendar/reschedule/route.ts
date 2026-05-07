import { NextRequest, NextResponse } from "next/server";
import { getCalendar } from "@/lib/google";
import { JERUSALEM_TZ, addMinutesJerusalem } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { eventId, newDate, newTime, duration } = await req.json();

  if (!eventId || !newDate || !newTime) {
    return NextResponse.json(
      { error: "eventId, newDate et newTime requis" },
      { status: 400 },
    );
  }

  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  try {
    const existing = await calendar.events.get({ calendarId, eventId });
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

    const updated = await calendar.events.patch({
      calendarId,
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
