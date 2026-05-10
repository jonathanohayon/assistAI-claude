import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

// Internal-only backfill: recopie les valeurs Google globales (env) sur la
// ligne `users` d'un admin, et (optionnellement) upsert un phone_numbers
// row pour le mapper. Utile depuis le commit "Fix: isolation tenant Google"
// qui force chaque user à avoir son propre refresh_token —
// l'admin (qui tournait via env globaux) se retrouvait sans credentials.
//
// Gated par INTERNAL_SECRET (admin login pas toujours dispo en headless).

const normalizeE164 = (input: string): string => {
  const stripped = input.trim().replace(/[\s()-]/g, "");
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
};

// GET = diag : renvoie l'état courant de l'admin (user + phone_numbers + agent_config)
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const email = req.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email requis" }, { status: 400 });
  }
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  const phones = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, u.id));
  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, u.id))
    .limit(1);
  return NextResponse.json({
    user: {
      id: u.id,
      email: u.email,
      role: u.role,
      googleConnected: Boolean(u.googleRefreshToken),
      googleCalendarId: u.googleCalendarId,
      googleSheetId: u.googleSheetId,
    },
    phones: phones.map((p) => ({
      phoneNumber: p.phoneNumber,
      label: p.label,
      twilioSid: p.twilioSid,
    })),
    agentConfig: cfg ? { id: cfg.id, ownerWhatsapp: cfg.ownerWhatsapp } : null,
  });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    userId?: string;
    phoneNumber?: string;
    label?: string;
    twilioSid?: string;
    countryCode?: string;
    role?: "admin" | "user";
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

  const updateSet: {
    googleRefreshToken: string;
    googleCalendarId: string;
    googleSheetId: string;
    role?: string;
  } = {
    googleRefreshToken: refreshToken,
    googleCalendarId: calendarId || "primary",
    googleSheetId: sheetId || "",
  };
  if (body.role === "admin" || body.role === "user") {
    updateSet.role = body.role;
  }

  const [updated] = await db
    .update(users)
    .set(updateSet)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      googleCalendarId: users.googleCalendarId,
      googleSheetId: users.googleSheetId,
    });

  if (!updated) {
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  }

  // Optionnel : upsert un phone_numbers row pour mapper le numéro à l'admin.
  let phoneUpsert: { phoneNumber: string; userId: string } | null = null;
  if (body.phoneNumber) {
    const e164 = normalizeE164(body.phoneNumber);
    // S'il existe déjà (même mappé à un autre user), on le repointe sur l'admin.
    const [existing] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.phoneNumber, e164))
      .limit(1);
    if (existing) {
      const [up] = await db
        .update(phoneNumbers)
        .set({
          userId,
          label: body.label ?? existing.label,
          twilioSid: body.twilioSid ?? existing.twilioSid,
          countryCode: body.countryCode ?? existing.countryCode,
        })
        .where(eq(phoneNumbers.id, existing.id))
        .returning();
      phoneUpsert = { phoneNumber: up.phoneNumber, userId: up.userId };
    } else {
      const [ins] = await db
        .insert(phoneNumbers)
        .values({
          userId,
          phoneNumber: e164,
          label: body.label ?? "",
          twilioSid: body.twilioSid ?? "",
          countryCode: body.countryCode ?? "",
        })
        .returning();
      phoneUpsert = { phoneNumber: ins.phoneNumber, userId: ins.userId };
    }
  }

  return NextResponse.json({
    ok: true,
    user: updated,
    refreshTokenSet: true,
    phoneUpsert,
  });
}
