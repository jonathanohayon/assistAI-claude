import { NextRequest, NextResponse } from "next/server";
import { getCalendar } from "@/lib/google";
import { jerusalemToUTCISO } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { date } = await req.json();
  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  const timeMin = jerusalemToUTCISO(date, "08:00:00");
  const timeMax = jerusalemToUTCISO(date, "20:00:00");

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      timeZone: "Asia/Jerusalem",
    });

    const events = res.data.items || [];
    const busySlots = events.map((e) => ({
      start: e.start?.dateTime,
      end: e.end?.dateTime,
    }));

    const slots: string[] = [];
    for (let h = 9; h < 18; h++) {
      for (const m of [0, 30]) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        const slotStartMs = new Date(jerusalemToUTCISO(date, `${hh}:${mm}:00`)).getTime();
        const slotEndMs = slotStartMs + 30 * 60_000;
        const busy = busySlots.some((b) => {
          if (!b.start || !b.end) return false;
          const bs = new Date(b.start).getTime();
          const be = new Date(b.end).getTime();
          return slotStartMs < be && slotEndMs > bs;
        });
        if (!busy) slots.push(`${hh}:${mm}`);
      }
    }

    return NextResponse.json({ date, available_slots: slots });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
