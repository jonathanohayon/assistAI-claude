import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// POST /api/google/select-calendar { calendarId: string }
// Updates the user's selected googleCalendarId. The agent's calendar tools and
// the dashboard listing both read users.googleCalendarId, so this change
// takes effect on the next call / page load.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let body: { calendarId?: unknown } = {};
  try {
    body = (await req.json()) as { calendarId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 });
  }

  const calendarId = typeof body.calendarId === "string" ? body.calendarId.trim() : "";
  // "primary" is the canonical Google alias; anything else is a calendar id
  // (long opaque string). Reject empty.
  if (!calendarId) {
    return NextResponse.json({ ok: false, reason: "missing_calendar_id" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ googleCalendarId: calendarId })
    .where(eq(users.id, session.user.id));

  await logEvent({
    source: "tenant",
    event: "calendar_selected",
    message: `${session.user.email ?? session.user.id} a sélectionné le calendrier ${calendarId}`,
    level: "info",
    userId: session.user.id,
    metadata: { calendarId },
  });

  return NextResponse.json({ ok: true, calendarId });
}
