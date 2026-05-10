import { NextRequest, NextResponse } from "next/server";

import { logEvent } from "@/lib/logger";
import { resolveTenant } from "@/lib/tenant";
import { sendWhatsApp } from "@/lib/whatsapp";

// Real-time WhatsApp notification from the agent during a call. Used when
// the caller leaves a message instead of booking — the agent collects the
// message + caller info and pushes it immediately to the owner's WhatsApp
// (vs the recap that lands at /api/calls/end after hangup).
//
// Auth: INTERNAL_SECRET (worker only) + x-tenant-phone header to route to
// the right tenant (same pattern as calendar tools).
//
// POST { message: string, callerName?: string, callerPhone?: string }
export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenantPhone = req.headers.get("x-tenant-phone");
  const tenant = await resolveTenant(tenantPhone);
  if (!tenant) {
    return NextResponse.json(
      { error: `Tenant inconnu pour ${tenantPhone || "(numéro absent)"}` },
      { status: 404 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    callerName?: string;
    callerPhone?: string;
  };

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message vide" }, { status: 400 });
  }

  const ownerWa = (tenant.config.ownerWhatsapp ?? "").trim();
  if (!ownerWa) {
    await logEvent({
      source: "whatsapp",
      event: "owner_unconfigured",
      message: `Pas de owner_whatsapp configuré pour ${tenant.user.email}`,
      level: "warn",
      userId: tenant.user.id,
    });
    return NextResponse.json(
      {
        error:
          "Le proprio n'a pas configuré son WhatsApp dans son dashboard. Le message ne peut pas être transmis.",
      },
      { status: 409 },
    );
  }

  const callerName = (body.callerName ?? "").trim();
  const callerPhone = (body.callerPhone ?? "").trim();

  // Format compact pour WhatsApp — visuellement distinct du recap de fin
  // d'appel. Emoji 💬 = message en direct (vs 📅 pour les RDV).
  const lines = [
    "💬 *Nouveau message* (transmis pendant l'appel)",
    "",
    callerName ? `👤 De : ${callerName}` : null,
    callerPhone ? `📞 Tel : ${callerPhone}` : null,
    callerName || callerPhone ? "" : null,
    "📝 Message :",
    message,
  ].filter((l): l is string => l !== null);

  const result = await sendWhatsApp({
    to: ownerWa,
    body: lines.join("\n"),
    ownerTemplateFallback: true,
  });

  if (!result.ok) {
    await logEvent({
      source: "whatsapp",
      event: "notify_failed",
      message: `Envoi WhatsApp échoué : ${result.error}`,
      level: "error",
      userId: tenant.user.id,
      metadata: { ownerWa, callerName, callerPhone, error: result.error },
    });
    return NextResponse.json(
      { error: result.error ?? "envoi WhatsApp échoué" },
      { status: 502 },
    );
  }

  await logEvent({
    source: "whatsapp",
    event: "notify_sent",
    message: `Message transmis à ${ownerWa} (${callerName || callerPhone || "anonyme"})`,
    userId: tenant.user.id,
    metadata: { ownerWa, callerName, callerPhone, sid: result.sid },
  });

  return NextResponse.json({ ok: true, sid: result.sid });
}
