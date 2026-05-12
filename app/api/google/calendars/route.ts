import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getTenantGoogleClients } from "@/lib/google";

// GET /api/google/calendars
// Returns the list of calendars the user has access to, so the dashboard can
// render a picker. Requires an active OAuth session (refresh token in DB).
// Returns { ok: false, reason: "not_connected" | "invalid_grant" | ... } when
// the call fails, so the UI can prompt a reconnect.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const clients = await getTenantGoogleClients(session.user.id);
  if (!clients) {
    return NextResponse.json({ ok: false, reason: "not_connected" }, { status: 200 });
  }

  try {
    const res = await clients.calendar.calendarList.list({
      minAccessRole: "writer",
      showHidden: false,
      maxResults: 100,
    });
    const items = (res.data.items ?? []).map((c) => ({
      id: c.id ?? "",
      summary: c.summary ?? "(sans titre)",
      primary: Boolean(c.primary),
      timeZone: c.timeZone ?? null,
    }));
    return NextResponse.json({
      ok: true,
      calendars: items,
      selectedId: clients.calendarId,
    });
  } catch (e) {
    const msg = (e as Error).message ?? "fetch_failed";
    const reason = msg.toLowerCase().includes("invalid_grant")
      ? "invalid_grant"
      : "fetch_failed";
    return NextResponse.json({ ok: false, reason, error: msg }, { status: 200 });
  }
}
