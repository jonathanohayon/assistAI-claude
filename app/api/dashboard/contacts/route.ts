import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getTenantGoogleClients, type TenantGoogleClients } from "@/lib/google";

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

// Resolve the connected user's own Sheet. Returns null if Google isn't
// connected or no sheet is configured — callers must short-circuit so we
// never read/write the admin's sheet.
const requireTenantSheet = async (
  userId: string,
): Promise<{ clients: TenantGoogleClients; sheetId: string } | null> => {
  const clients = await getTenantGoogleClients(userId);
  if (!clients || !clients.sheetId) return null;
  return { clients, sheetId: clients.sheetId };
};

// GET — list all contacts (newest first)
export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenant = await requireTenantSheet(session.user.id);
  if (!tenant) {
    return NextResponse.json({
      contacts: [],
      headers: HEADERS,
      notConnected: true,
    });
  }

  const res = await tenant.clients.sheets.spreadsheets.values.get({
    spreadsheetId: tenant.sheetId,
    range: SHEET_RANGE,
  });

  const rows = res.data.values ?? [];
  const startIndex =
    rows[0]?.[0]?.toString().toLowerCase().includes("timestamp") ||
    rows[0]?.[1]?.toString().toLowerCase().includes("nom")
      ? 1
      : 0;

  const contacts: Contact[] = rows.slice(startIndex).map((r, i) => ({
    rowIndex: startIndex + i + 1,
    timestamp: r[0] ?? "",
    name: r[1] ?? "",
    phone: r[2] ?? "",
    email: r[3] ?? "",
    notes: r[4] ?? "",
  }));

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

  const tenant = await requireTenantSheet(session.user.id);
  if (!tenant) {
    return NextResponse.json(
      { error: "Google Sheet non connecté" },
      { status: 409 },
    );
  }

  const existing = await tenant.clients.sheets.spreadsheets.values.get({
    spreadsheetId: tenant.sheetId,
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

  await tenant.clients.sheets.spreadsheets.values.update({
    spreadsheetId: tenant.sheetId,
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

  const tenant = await requireTenantSheet(session.user.id);
  if (!tenant) {
    return NextResponse.json(
      { error: "Google Sheet non connecté" },
      { status: 409 },
    );
  }

  await tenant.clients.sheets.spreadsheets.values.clear({
    spreadsheetId: tenant.sheetId,
    range: `Contacts!A${rowIndex}:E${rowIndex}`,
  });

  return NextResponse.json({ ok: true, rowIndex });
}
