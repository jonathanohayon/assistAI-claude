import { and, desc, eq, gte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls, events } from "@/lib/db/schema";

// Outil de diag : dernier appel + summary + events liés. Gated INTERNAL_SECRET.
// Inclut maintenant les events `whatsapp_*` post-appel pour qu'on sache
// pourquoi le proprio n'a pas reçu son recap (skipped_dedup / failed_owner /
// undelivered Twilio status check).
//
// Env exposés (booleans only, jamais la valeur) : indique si les SIDs de
// templates WhatsApp sont configurés pour chaque langue.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [latest] = await db
    .select()
    .from(calls)
    .orderBy(desc(calls.createdAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json({ error: "no calls yet" }, { status: 404 });
  }

  // Events liés à ce call : on filtre par userId + fenêtre temporelle.
  // 1h avant le call pour capturer les envois précédents qui pourraient
  // expliquer un dedup_recent_owner_message. Le metadata.callId match
  // aurait été plus propre mais drizzle ne grep pas le json en SQL portable.
  const callWindowStart = new Date(latest.createdAt.getTime() - 60 * 60 * 1000);
  const relatedEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, latest.userId),
        gte(events.createdAt, callWindowStart),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(50);

  return NextResponse.json({
    call: {
      id: latest.id,
      userId: latest.userId,
      createdAt: latest.createdAt,
      fromNumber: latest.fromNumber,
      transcript: latest.transcript,
      summary: latest.summary,
      whatsappClientSid: latest.whatsappClientSid,
      whatsappOwnerSid: latest.whatsappOwnerSid,
      whatsappError: latest.whatsappError,
    },
    events: relatedEvents.map((e) => ({
      createdAt: e.createdAt,
      source: e.source,
      event: e.event,
      level: e.level,
      message: e.message,
      metadata: e.metadata,
    })),
    env: {
      WHATSAPP_OWNER_TEMPLATE_SID: Boolean(process.env.WHATSAPP_OWNER_TEMPLATE_SID),
      WHATSAPP_OWNER_TEMPLATE_SID_HE: Boolean(process.env.WHATSAPP_OWNER_TEMPLATE_SID_HE),
      WHATSAPP_OWNER_TEMPLATE_SID_EN: Boolean(process.env.WHATSAPP_OWNER_TEMPLATE_SID_EN),
      WHATSAPP_OWNER_TEMPLATE_SID_FR: Boolean(process.env.WHATSAPP_OWNER_TEMPLATE_SID_FR),
      WHATSAPP_CLIENT_TEMPLATE_SID: Boolean(process.env.WHATSAPP_CLIENT_TEMPLATE_SID),
      WHATSAPP_CLIENT_TEMPLATE_SID_HE: Boolean(process.env.WHATSAPP_CLIENT_TEMPLATE_SID_HE),
      WHATSAPP_CLIENT_TEMPLATE_SID_EN: Boolean(process.env.WHATSAPP_CLIENT_TEMPLATE_SID_EN),
      WHATSAPP_CLIENT_TEMPLATE_SID_FR: Boolean(process.env.WHATSAPP_CLIENT_TEMPLATE_SID_FR),
    },
  });
}
