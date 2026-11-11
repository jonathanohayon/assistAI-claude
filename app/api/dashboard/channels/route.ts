import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentNumberFromRow, legacyChannelNumber } from "@/lib/channels/adapters";
import { phoneNumbers } from "@/lib/db/schema";

// Twilio stores WhatsApp numbers with a `whatsapp:` prefix in
// phone_numbers.phoneNumber; PSTN numbers are bare E.164. The channel comes
// from the prefix, which is stripped for display — through the Channels
// contract adapters (C1, lib/channels/adapters.ts), same output as before.

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

  const numbers = rows.map((row) => legacyChannelNumber(agentNumberFromRow(row)));

  return NextResponse.json({ numbers });
}
