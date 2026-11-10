import { and, asc, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { callMeAllowed, callMeTarget } from "@/lib/call-me";
import { callMeRoomName, dialCallMe } from "@/lib/campaigns/dial";
import { db } from "@/lib/db";
import { agentConfigs, events, phoneNumbers } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

export const maxDuration = 60;

// POST /api/dashboard/call-me[?asUserId=]  body { phoneNumber? }
// The tenant's receptionist calls the owner (default: the owner's WhatsApp
// number) so they hear their own agent on a real phone line. Returns once
// the owner answers (30 s ringing max).
//   200 { ok: true }
//   400 invalid_phone (no valid number) · no_tenant_number (no line to call from)
//   429 too_soon (one call-back every 2 min) · 502 call_failed (no answer / busy / trunk)
// No supplier name in the response.
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { phoneNumber?: unknown };

  const [cfg] = await db
    .select({ ownerWhatsapp: agentConfigs.ownerWhatsapp })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, r.userId))
    .limit(1);
  if (!cfg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const phoneNumber = callMeTarget(body.phoneNumber, cfg.ownerWhatsapp);
  if (!phoneNumber) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const [line] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, r.userId))
    .orderBy(asc(phoneNumbers.createdAt))
    .limit(1);
  if (!line) return NextResponse.json({ error: "no_tenant_number" }, { status: 400 });

  const [last] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.userId, r.userId), eq(events.event, "call_me_started")))
    .orderBy(desc(events.createdAt))
    .limit(1);
  if (!callMeAllowed(last?.createdAt ?? null)) return NextResponse.json({ error: "too_soon" }, { status: 429 });

  await logEvent({ source: "web", event: "call_me_started", message: "Call-back to the owner started", userId: r.userId });
  try {
    await dialCallMe({ userId: r.userId, phoneNumber, fromNumber: line.phoneNumber, roomName: callMeRoomName(r.userId) });
  } catch (e) {
    await logEvent({
      source: "web",
      event: "call_me_failed",
      level: "warn",
      message: `Call-back failed: ${(e as Error).message.slice(0, 200)}`,
      userId: r.userId,
    });
    return NextResponse.json({ error: "call_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
