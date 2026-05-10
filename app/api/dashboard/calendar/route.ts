import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getTenantGoogleClients } from "@/lib/google";
import { JERUSALEM_TZ } from "@/lib/tz";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

// All routes here read/write the *connected user's own* Google Calendar via
// their stored refresh_token. If the user hasn't connected Google, we refuse
// (409) rather than silently falling back to the admin's calendar.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clients = await getTenantGoogleClients(session.user.id);
  if (!clients) {
    return NextResponse.json({ events: [], notConnected: true });
  }

  const days = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("days") ?? "14"), 1),
    90,
  );

  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const res = await clients.calendar.events.list({
    calendarId: clients.calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: JERUSALEM_TZ,
    maxResults: 100,
  });

  const events: CalendarEvent[] = (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(sans titre)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description ?? "",
    link: e.htmlLink ?? "",
  }));

  return NextResponse.json({ events });
}

// PUT /api/dashboard/calendar — body { eventId, summary?, description?,
//   start?, end? } (start/end as YYYY-MM-DD HH:mm in Jerusalem)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    eventId?: string;
    summary?: string;
    description?: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
  };

  if (!body.eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const clients = await getTenantGoogleClients(session.user.id);
  if (!clients) {
    return NextResponse.json(
      { error: "Google Calendar non connecté" },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.summary != null) patch.summary = body.summary;
  if (body.description != null) patch.description = body.description;
  if (body.startDate && body.startTime) {
    patch.start = {
      dateTime: `${body.startDate}T${body.startTime}:00`,
      timeZone: JERUSALEM_TZ,
    };
  }
  if (body.endDate && body.endTime) {
    patch.end = {
      dateTime: `${body.endDate}T${body.endTime}:00`,
      timeZone: JERUSALEM_TZ,
    };
  }

  try {
    const updated = await clients.calendar.events.patch({
      calendarId: clients.calendarId,
      eventId: body.eventId,
      requestBody: patch,
    });
    return NextResponse.json({
      ok: true,
      event: {
        id: updated.data.id,
        summary: updated.data.summary,
        start: updated.data.start?.dateTime,
        end: updated.data.end?.dateTime,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "calendar update failed" },
      { status: 500 },
    );
  }
}

// DELETE /api/dashboard/calendar?eventId=...
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const clients = await getTenantGoogleClients(session.user.id);
  if (!clients) {
    return NextResponse.json(
      { error: "Google Calendar non connecté" },
      { status: 409 },
    );
  }

  try {
    await clients.calendar.events.delete({
      calendarId: clients.calendarId,
      eventId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
