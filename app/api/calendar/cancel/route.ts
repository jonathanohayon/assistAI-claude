import { NextRequest, NextResponse } from "next/server";

import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json();

  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const caller = await resolveAgentCallerGoogle(req);
  if (caller.mode === "user_no_google") {
    return NextResponse.json(
      { error: "Google Calendar non connecté pour ce compte." },
      { status: 409 },
    );
  }
  if (caller.mode === "unknown_tenant") {
    return NextResponse.json(
      { error: `Tenant inconnu pour ${caller.dialedPhone || "(numéro absent)"}` },
      { status: 404 },
    );
  }

  try {
    await caller.calendar.events.delete({
      calendarId: caller.calendarId,
      eventId,
    });
    await logEvent({
      source: "calendar",
      event: "cancel_success",
      message: `RDV annulé`,
      metadata: { eventId },
    });
    return NextResponse.json({ success: true, message: "RDV annulé." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur annulation";
    await logEvent({
      source: "calendar",
      event: "cancel_failed",
      message: `Annulation échouée : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { eventId, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
