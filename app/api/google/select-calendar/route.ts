import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/google/select-calendar[?asUserId=<uuid>] { calendarId: string }
// Updates the user's selected googleCalendarId. The agent's calendar tools and
// the dashboard listing both read users.googleCalendarId, so this change
// takes effect on the next call / page load.
//
// `asUserId` autorisé pour admin → update le tenant cible.
export async function POST(req: NextRequest) {
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

  let body: { calendarId?: unknown } = {};
  try {
    body = (await req.json()) as { calendarId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 });
  }

  const calendarId = typeof body.calendarId === "string" ? body.calendarId.trim() : "";
  if (!calendarId) {
    return NextResponse.json({ ok: false, reason: "missing_calendar_id" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ googleCalendarId: calendarId })
    .where(eq(users.id, scope.userId));

  await logEvent({
    source: "tenant",
    event: "calendar_selected",
    message: `${session.user.email ?? session.user.id} a sélectionné le calendrier ${calendarId} pour ${scope.userId}`,
    level: "info",
    userId: scope.userId,
    metadata: { calendarId, selectedBy: session.user.id },
  });

  return NextResponse.json({ ok: true, calendarId });
}
