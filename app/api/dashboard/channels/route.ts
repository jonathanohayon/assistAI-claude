import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { phoneNumbers } from "@/lib/db/schema";

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

// GET — liste les numéros du tenant avec leur canal (PSTN / WhatsApp).
// L'admin peut voir les numéros d'un tenant via ?asUserId (resolveTargetUserId
// centralisé dans lib/api/auth-guards).
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
