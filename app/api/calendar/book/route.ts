import { NextRequest, NextResponse } from "next/server";

import { getCalendar } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { JERUSALEM_TZ, addMinutesJerusalem } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { name, phone, email, date, time, duration = 30, description } =
    await req.json();

  if (!name || !phone || !date || !time) {
    await logEvent({
      source: "calendar",
      event: "book_invalid",
      message: `Réservation refusée — champs manquants`,
      level: "warn",
      metadata: { name, phone, date, time },
    });
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 400 });
  }

  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const endParts = addMinutesJerusalem(date, time, duration);

  try {
    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `RDV - ${name}`,
        description: [
          description || "Rendez-vous",
          `Tel: ${phone}`,
          email ? `Email: ${email}` : "",
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
      message: `RDV créé : ${name} · ${date} ${time}`,
      metadata: {
        eventId: event.data.id,
        name,
        phone,
        date,
        time,
        duration,
      },
    });

    return NextResponse.json({
      success: true,
      eventId: event.data.id,
      link: event.data.htmlLink,
      summary: `RDV confirmé le ${date} à ${time} pour ${name}`,
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
