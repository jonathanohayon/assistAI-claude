import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Internal-only backfill: recopie les valeurs Google globales (env) sur la
// ligne `users` d'un admin. Utile depuis le commit "Fix: isolation tenant
// Google" qui force chaque user à avoir son propre refresh_token —
// l'admin (qui tournait via env globaux) se retrouvait sans credentials.
//
// Gated par INTERNAL_SECRET (admin login pas toujours dispo en headless).
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    userId?: string;
  };

  let userId = body.userId;
  if (!userId && body.email) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!u) {
      return NextResponse.json({ error: "user introuvable" }, { status: 404 });
    }
    userId = u.id;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "userId ou email requis" },
      { status: 400 },
    );
  }

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!refreshToken) {
    return NextResponse.json(
      { error: "GOOGLE_REFRESH_TOKEN absent dans l'env" },
      { status: 500 },
    );
  }

  const [updated] = await db
    .update(users)
    .set({
      googleRefreshToken: refreshToken,
      googleCalendarId: calendarId || "primary",
      googleSheetId: sheetId || "",
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      googleCalendarId: users.googleCalendarId,
      googleSheetId: users.googleSheetId,
    });

  if (!updated) {
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    user: updated,
    refreshTokenSet: true,
  });
}
