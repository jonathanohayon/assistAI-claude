import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";

const normalizeE164 = (input: string): string => {
  const cleaned = input.trim().replace(/[\s()-]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
};

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return me?.role === "admin" ? me : null;
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    phoneNumber?: string;
    label?: string;
    // 'whatsapp' = numéro WhatsApp Business (appels WhatsApp) → stocké avec le
    // préfixe `whatsapp:` pour que resolveTenantByPhone matche le canal. Défaut
    // 'pstn' (numéro téléphonique classique).
    channel?: string;
  };

  if (!body.userId || !body.phoneNumber) {
    return NextResponse.json(
      { error: "userId + phoneNumber requis" },
      { status: 400 },
    );
  }

  const normalized = normalizeE164(body.phoneNumber);
  if (!/^\+\d{6,15}$/.test(normalized)) {
    return NextResponse.json(
      { error: "phoneNumber invalide (E.164 attendu, ex: +97223764700)" },
      { status: 400 },
    );
  }
  // Canal WhatsApp → on persiste `whatsapp:+<E164>` (cf. resolveTenantByPhone +
  // /api/twilio/voice-bridge qui réattache le préfixe au SIP user part).
  const stored =
    body.channel === "whatsapp" ? `whatsapp:${normalized}` : normalized;

  // Verify the target tenant exists.
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, body.userId))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "tenant introuvable" }, { status: 404 });
  }

  try {
    const [created] = await db
      .insert(phoneNumbers)
      .values({
        userId: body.userId,
        phoneNumber: stored,
        label: body.label?.trim() ?? "",
      })
      .returning();
    return NextResponse.json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "insert failed";
    if (/duplicate|unique/i.test(msg)) {
      return NextResponse.json(
        { error: "Ce numéro est déjà assigné à un autre tenant" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id manquant" }, { status: 400 });
  }
  await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id));
  return NextResponse.json({ ok: true });
}
