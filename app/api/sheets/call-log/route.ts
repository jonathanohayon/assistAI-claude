import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import {
  ensureSheet,
  forceTextPhone,
  prependRow,
} from "@/lib/sheets-helpers";

const APPELS_SHEET_TITLE = "Appels";
const APPELS_HEADERS = [
  "Date",
  "Heure",
  "Caller",
  "Numéro",
  "Durée",
  "Type",
  "Résumé",
];

// Push un récap d'appel au TOP de la sheet "Appels" (le plus récent en haut).
// Appelé par /api/calls/end après un appel terminé. Insertion en row 2 via
// insertDimension → pas besoin de tri post-hoc.
//
// Body JSON :
//   { fromNumber, callerName?, durationSeconds?, type?, summary? }
//
// Auth : INTERNAL_SECRET + x-tenant-phone (même pattern que les calendar tools).
export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (!guard.ok) return guard.response;

  // body optionnel : tous les champs sont facultatifs (cellules vides).
  const body = (await req.json().catch(() => ({}))) as {
    fromNumber?: string;
    callerName?: string;
    durationSeconds?: number;
    type?: string;
    summary?: string;
  };

  const caller = await resolveAgentCallerGoogle(req);
  if (caller.mode === "user_no_google") {
    return NextResponse.json(
      { error: "Google Sheet non connecté pour ce compte." },
      { status: 409 },
    );
  }
  if (caller.mode === "unknown_tenant") {
    return NextResponse.json(
      { error: `Tenant inconnu pour ${caller.dialedPhone || "(numéro absent)"}` },
      { status: 404 },
    );
  }
  if (!caller.sheetId) {
    return NextResponse.json(
      { error: "Aucun Google Sheet configuré pour ce compte." },
      { status: 500 },
    );
  }
  const spreadsheetId = caller.sheetId;

  // Format date/heure en France pour lisibilité par le proprio.
  const now = new Date();
  const date = now.toLocaleDateString("fr-FR", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const heure = now.toLocaleTimeString("fr-FR", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Durée formatée mm:ss (ex: "3:42") quand fournie.
  const dur = body.durationSeconds;
  const durFormatted =
    typeof dur === "number" && dur > 0
      ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`
      : "";

  const newRow = [
    date,
    heure,
    body.callerName ?? "",
    forceTextPhone(body.fromNumber ?? ""),
    durFormatted,
    body.type ?? "",
    body.summary ?? "",
  ];

  try {
    const sheetId = await ensureSheet({
      sheets: caller.sheets,
      spreadsheetId,
      title: APPELS_SHEET_TITLE,
      headers: APPELS_HEADERS,
    });

    await prependRow({
      sheets: caller.sheets,
      spreadsheetId,
      sheetId,
      sheetTitle: APPELS_SHEET_TITLE,
      newRow,
    });

    await logEvent({
      source: "sheets",
      event: "call_log_added",
      message: `Appel loggé dans Sheets : ${body.callerName || "?"} · ${body.fromNumber || "?"}`,
      metadata: {
        fromNumber: body.fromNumber,
        callerName: body.callerName,
        type: body.type,
        durationSeconds: body.durationSeconds,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Sheets";
    await logEvent({
      source: "sheets",
      event: "call_log_failed",
      message: `Push appel échoué : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { fromNumber: body.fromNumber, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
