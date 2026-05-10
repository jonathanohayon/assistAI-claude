import { NextRequest, NextResponse } from "next/server";

import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const { name, phone, email = "", notes = "" } = await req.json();

  if (!name || !phone) {
    return NextResponse.json({ error: "Nom et téléphone requis" }, { status: 400 });
  }

  const caller = await resolveAgentCallerGoogle();
  if (caller.mode === "user_no_google") {
    return NextResponse.json(
      { error: "Google Sheet non connecté pour ce compte." },
      { status: 409 },
    );
  }
  if (!caller.sheetId) {
    await logEvent({
      source: "sheets",
      event: "contact_misconfigured",
      message:
        caller.mode === "demo"
          ? "GOOGLE_SHEET_ID non configuré"
          : "Sheet ID manquant pour ce compte",
      level: "error",
    });
    return NextResponse.json(
      { error: "Aucun Google Sheet configuré pour ce compte." },
      { status: 500 },
    );
  }
  const spreadsheetId = caller.sheetId;

  const now = new Date().toLocaleString("fr-FR", { timeZone: "Asia/Jerusalem" });

  try {
    await caller.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Contacts!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[now, name, phone, email, notes]],
      },
    });

    await logEvent({
      source: "sheets",
      event: "contact_added",
      message: `Contact ajouté : ${name} · ${phone}`,
      metadata: { name, phone, email, notes },
    });

    return NextResponse.json({ success: true, message: `Contact ${name} enregistré` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Sheets";
    await logEvent({
      source: "sheets",
      event: "contact_failed",
      message: `Ajout contact échoué : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { name, phone, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
