import { NextRequest, NextResponse } from "next/server";
import { resolveAgentCallerGoogle } from "@/lib/google";
import { jerusalemToUTCISO } from "@/lib/tz";

const normalize = (s: string) => s.replace(/[^\d]/g, "");

export async function POST(req: NextRequest) {
  const { phone, date } = await req.json();

  if (!phone) {
    return NextResponse.json({ error: "Téléphone requis" }, { status: 400 });
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
  const phoneDigits = normalize(phone);

  let timeMin: string;
  let timeMax: string;
  if (date) {
    timeMin = jerusalemToUTCISO(date, "00:00:00");
    timeMax = jerusalemToUTCISO(date, "23:59:59");
  } else {
    const now = new Date();
    timeMin = now.toISOString();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    timeMax = future.toISOString();
  }

  try {
    const res = await caller.calendar.events.list({
      calendarId: caller.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
      timeZone: "Asia/Jerusalem",
    });

    const events = (res.data.items || [])
      .filter((e) => normalize(e.description || "").includes(phoneDigits))
      .map((e) => ({
        eventId: e.id,
        summary: e.summary,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
      }));

    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur calendrier";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
