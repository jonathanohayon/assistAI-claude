import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { phoneNumbers } from "@/lib/db/schema";
import { resolveScopeUserId } from "@/lib/admin-impersonate";

// Twilio encode les numéros WhatsApp avec le préfixe `whatsapp:` dans
// phone_numbers.phoneNumber ; les numéros PSTN classiques sont stockés en
// E.164 nu (`+...`). On dérive le canal du préfixe et on le retire pour
// l'affichage côté UI.
const WHATSAPP_PREFIX = "whatsapp:";

type Channel = "pstn" | "whatsapp";

interface ChannelNumber {
  id: string;
  phoneNumber: string;
  channel: Channel;
  label: string;
  countryCode: string;
}

// Résout l'userId effectif : session.user.id par défaut, OU asUserId si le
// caller est admin (sinon 403). Même pattern que les autres routes
// /api/dashboard/* — l'admin peut donc voir les numéros d'un tenant via
// le prop asUserId du ConfigForm.
async function resolveTargetUserId(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return { unauthorized: true as const };
  const asUserId = req.nextUrl.searchParams.get("asUserId");
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId,
  });
  if ("forbidden" in scope) return { forbidden: true as const };
  return { userId: scope.userId };
}

// GET — liste les numéros du tenant avec leur canal (PSTN / WhatsApp).
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, r.userId));

  const numbers: ChannelNumber[] = rows.map((row) => {
    const isWhatsapp = row.phoneNumber.startsWith(WHATSAPP_PREFIX);
    return {
      id: row.id,
      phoneNumber: isWhatsapp
        ? row.phoneNumber.slice(WHATSAPP_PREFIX.length)
        : row.phoneNumber,
      channel: isWhatsapp ? "whatsapp" : "pstn",
      label: row.label,
      countryCode: row.countryCode,
    };
  });

  return NextResponse.json({ numbers });
}
