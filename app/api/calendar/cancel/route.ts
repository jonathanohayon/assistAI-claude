import { NextRequest, NextResponse } from "next/server";

import { getCalendar } from "@/lib/google";
import { logEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json();

  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  try {
    await calendar.events.delete({ calendarId, eventId });
    await logEvent({
      source: "calendar",
      event: "cancel_success",
      message: `RDV annulé`,
      metadata: { eventId },
    });
    return NextResponse.json({ success: true, message: "RDV annulé." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur annulation";
    await logEvent({
      source: "calendar",
      event: "cancel_failed",
      message: `Annulation échouée : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { eventId, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
