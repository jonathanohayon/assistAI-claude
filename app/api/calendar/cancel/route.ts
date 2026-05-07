import { NextRequest, NextResponse } from "next/server";
import { getCalendar } from "@/lib/google";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json();

  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  try {
    await calendar.events.delete({ calendarId, eventId });
    return NextResponse.json({ success: true, message: "RDV annulé." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur annulation";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
