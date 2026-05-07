import { NextRequest, NextResponse } from "next/server";
import { getSheets } from "@/lib/google";

export async function POST(req: NextRequest) {
  const { name, phone, email = "", notes = "" } = await req.json();

  if (!name || !phone) {
    return NextResponse.json({ error: "Nom et téléphone requis" }, { status: 400 });
  }

  const sheets = getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
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

    return NextResponse.json({ success: true, message: `Contact ${name} enregistré` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Sheets";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
