import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { getTenantGoogleClients } from "@/lib/google";

// GET /api/google/calendars[?asUserId=<uuid>]
// Returns the list of calendars the user has access to, so the dashboard can
// render a picker. Requires an active OAuth session (refresh token in DB).
// Returns { ok: false, reason: "not_connected" | "invalid_grant" | ... } when
// the call fails, so the UI can prompt a reconnect.
//
// `asUserId` autorisé pour admin uniquement → liste les calendriers du
// tenant cible (pour /admin/users/[id]/calendar).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId: req.nextUrl.searchParams.get("asUserId"),
  });
  if ("forbidden" in scope) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const clients = await getTenantGoogleClients(scope.userId);
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
