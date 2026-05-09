import { NextRequest, NextResponse } from "next/server";

import { getSheets } from "@/lib/google";
import { logEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const { name, phone, email = "", notes = "" } = await req.json();

  if (!name || !phone) {
    return NextResponse.json({ error: "Nom et téléphone requis" }, { status: 400 });
  }

  const sheets = getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    await logEvent({
      source: "sheets",
      event: "contact_misconfigured",
      message: "GOOGLE_SHEET_ID non configuré",
      level: "error",
    });
    return NextResponse.json({ error: "GOOGLE_SHEET_ID non configuré" }, { status: 500 });
  }

  const now = new Date().toLocaleString("fr-FR", { timeZone: "Asia/Jerusalem" });

  try {
    await sheets.spreadsheets.values.append({
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
