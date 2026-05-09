import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getSheets } from "@/lib/google";

const SHEET_RANGE = "Contacts!A:E";
// Columns: timestamp | name | phone | email | notes (matches /api/sheets/contact)
const HEADERS = ["timestamp", "name", "phone", "email", "notes"] as const;

interface Contact {
  rowIndex: number; // 1-based, includes header row → first data row = 2
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

const requireAuth = async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session;
};

const requireSheetId = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID non configuré");
  return id;
};

// GET — list all contacts (newest first)
export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sheets = getSheets();
  const spreadsheetId = requireSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEET_RANGE,
  });

  const rows = res.data.values ?? [];
  // Detect header row (first row matching the expected schema). If absent,
  // start from row 1.
  const startIndex =
    rows[0]?.[0]?.toString().toLowerCase().includes("timestamp") ||
    rows[0]?.[1]?.toString().toLowerCase().includes("nom")
      ? 1
      : 0;

  const contacts: Contact[] = rows.slice(startIndex).map((r, i) => ({
    rowIndex: startIndex + i + 1, // 1-based
    timestamp: r[0] ?? "",
    name: r[1] ?? "",
    phone: r[2] ?? "",
    email: r[3] ?? "",
    notes: r[4] ?? "",
  }));

  // Newest first.
  contacts.reverse();

  return NextResponse.json({ contacts, headers: HEADERS });
}

// PUT — update a row by rowIndex
export async function PUT(req: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    rowIndex?: number;
    name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    timestamp?: string;
  };

  if (!body.rowIndex || body.rowIndex < 1) {
    return NextResponse.json({ error: "rowIndex invalide" }, { status: 400 });
  }

  const sheets = getSheets();
  const spreadsheetId = requireSheetId();

  // Read the existing row first so we can patch only changed fields.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Contacts!A${body.rowIndex}:E${body.rowIndex}`,
  });
  const current = existing.data.values?.[0] ?? [];
  const next = [
    body.timestamp ?? current[0] ?? "",
    body.name ?? current[1] ?? "",
    body.phone ?? current[2] ?? "",
    body.email ?? current[3] ?? "",
    body.notes ?? current[4] ?? "",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Contacts!A${body.rowIndex}:E${body.rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [next] },
  });

  return NextResponse.json({ ok: true, rowIndex: body.rowIndex });
}

// DELETE — clear a row's content (we don't shift rows to keep rowIndex stable)
export async function DELETE(req: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rowIndex = Number(req.nextUrl.searchParams.get("rowIndex"));
  if (!rowIndex || rowIndex < 1) {
    return NextResponse.json({ error: "rowIndex invalide" }, { status: 400 });
  }

  const sheets = getSheets();
  const spreadsheetId = requireSheetId();

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `Contacts!A${rowIndex}:E${rowIndex}`,
  });

  return NextResponse.json({ ok: true, rowIndex });
}
