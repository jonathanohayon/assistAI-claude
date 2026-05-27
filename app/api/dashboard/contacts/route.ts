import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
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

// Résout l'userId effectif : session.user.id par défaut, OU asUserId
// si caller admin (sinon 403). Retourne un discriminated result.
async function resolveTargetUserId(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return { unauthorized: true as const };
  const asUserId = req.nextUrl.searchParams.get("asUserId");
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId,
  });
  if ("forbidden" in scope) return { forbidden: true as const };
  return { userId: scope.userId };
}

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
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tenant = await requireTenantSheet(r.userId);
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
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const tenant = await requireTenantSheet(r.userId);
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
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rowIndex = Number(req.nextUrl.searchParams.get("rowIndex"));
  if (!rowIndex || rowIndex < 1) {
    return NextResponse.json({ error: "rowIndex invalide" }, { status: 400 });
  }

  const tenant = await requireTenantSheet(r.userId);
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
