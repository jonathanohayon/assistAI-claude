import { NextRequest, NextResponse } from "next/server";

import { AGENT_CALLER_UNAUTHORIZED_BODY, requireAgentCaller, resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { callIdMeta } from "@/lib/call-id";

export async function POST(req: NextRequest) {
  // No internal secret and no session → 401 before anything else.
  const gate = await requireAgentCaller(req);
  if (!gate.ok) return gate.response;
  const { eventId } = await req.json();

  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const caller = await resolveAgentCallerGoogle(req);
  if (caller.mode === "anonymous") {
    // Unreachable behind the gate above; kept so no path can use a client.
    return NextResponse.json(AGENT_CALLER_UNAUTHORIZED_BODY, { status: 401 });
  }
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
      // Attributed to the tenant (like book_success): the call type and the
      // dashboard read tool events by user_id.
      ...(caller.mode === "tenant" ? { userId: caller.userId } : {}),
      metadata: { ...callIdMeta(req), eventId },
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
