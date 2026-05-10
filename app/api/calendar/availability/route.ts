import { NextRequest, NextResponse } from "next/server";

import { resolveAgentCallerGoogle } from "@/lib/google";
import { type Center, centerForDate, dayNameFr, labelFor } from "@/lib/schedule";
import { jerusalemToUTCISO } from "@/lib/tz";

export async function POST(req: NextRequest) {
  const { date, center } = await req.json();

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
    return NextResponse.json({
      date,
      center: allowedCenter,
      label: labelFor(allowedCenter),
      available_slots: [],
      reason: `Le ${date} (${dayNameFr(date)}), le centre ouvert est ${labelFor(allowedCenter)} — pas ${center}.`,
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

  const timeMin = jerusalemToUTCISO(date, "08:00:00");
  const timeMax = jerusalemToUTCISO(date, "20:00:00");

  try {
    const res = await caller.calendar.events.list({
      calendarId: caller.calendarId,
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
        const slotStartMs = new Date(
          jerusalemToUTCISO(date, `${hh}:${mm}:00`),
        ).getTime();
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

    return NextResponse.json({
      date,
      center: allowedCenter,
      label: labelFor(allowedCenter),
      available_slots: slots,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
