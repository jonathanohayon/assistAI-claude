import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSheetsFor } from "@/lib/google";
import { listSpreadsheets, type DriveFile } from "@/lib/google-drive";
import { ensureSheet } from "@/lib/sheets-helpers";
import { getOrdersSheetId, setOrdersSheetId } from "@/lib/tenant-sheets";

export const dynamic = "force-dynamic";

// Gestion du choix des Google Sheets du tenant :
//   - "customers" : carnet de contacts → stocké dans users.googleSheetId,
//     onglet "Contacts" (timestamp/nom/téléphone/email/notes).
//   - "orders"    : réservations/commandes → stocké dans app_settings
//     (tenant_orders_sheets), onglet "Commandes"
//     (date/heure/nom/téléphone/description/centre).
//
// GET  → état courant (id sélectionné + nom + liste Drive + scopeMissing).
// POST → "create" (nouveau spreadsheet) ou "select" (lier un existant).

type SheetType = "customers" | "orders";

const CUSTOMERS_TAB = "Contacts";
const CUSTOMERS_HEADERS = ["timestamp", "nom", "téléphone", "email", "notes"];

const ORDERS_TAB = "Commandes";
const ORDERS_HEADERS = ["date", "heure", "nom", "téléphone", "description", "centre"];

const isSheetType = (v: unknown): v is SheetType =>
  v === "customers" || v === "orders";

// Charge la row users (refresh token + sheet clients) du tenant.
async function loadUser(userId: string) {
  const [me] = await db
    .select({
      refreshToken: users.googleRefreshToken,
      googleSheetId: users.googleSheetId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return me ?? null;
}

export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const typeParam = req.nextUrl.searchParams.get("type");
  if (!isSheetType(typeParam)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const type = typeParam;

  const me = await loadUser(r.userId);
  if (!me?.refreshToken) {
    return NextResponse.json(
      { error: "google_not_connected" },
      { status: 409 },
    );
  }

  const selectedId =
    type === "customers"
      ? me.googleSheetId?.trim() || null
      : await getOrdersSheetId(r.userId);

  const listed = await listSpreadsheets(me.refreshToken);
  const list: DriveFile[] | null = listed.ok ? listed.files : null;
  const scopeMissing = listed.ok ? false : listed.scopeMissing;

  const selectedName =
    selectedId && list
      ? (list.find((f) => f.id === selectedId)?.name ?? null)
      : null;

  return NextResponse.json({ selectedId, selectedName, list, scopeMissing });
}

export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseJsonBody<{
    type?: string;
    action?: string;
    name?: string;
    id?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!isSheetType(body.type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const type = body.type;

  const me = await loadUser(r.userId);
  if (!me?.refreshToken) {
    return NextResponse.json(
      { error: "google_not_connected" },
      { status: 409 },
    );
  }

  const tab = type === "customers" ? CUSTOMERS_TAB : ORDERS_TAB;
  const headers = type === "customers" ? CUSTOMERS_HEADERS : ORDERS_HEADERS;

  // Persiste l'id dans la bonne destination selon le type.
  const persist = async (sheetId: string) => {
    if (type === "customers") {
      await db
        .update(users)
        .set({ googleSheetId: sheetId })
        .where(eq(users.id, r.userId));
    } else {
      await setOrdersSheetId(r.userId, sheetId);
    }
  };

  if (body.action === "create") {
    const title = (body.name ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    try {
      const sheets = getSheetsFor(me.refreshToken);
      const created = await sheets.spreadsheets.create({
        requestBody: { properties: { title } },
      });
      const id = created.data.spreadsheetId;
      if (!id) {
        return NextResponse.json(
          { error: "create_failed" },
          { status: 502 },
        );
      }
      // Initialise l'onglet attendu (idempotent).
      await ensureSheet({ sheets, spreadsheetId: id, title: tab, headers });
      await persist(id);
      return NextResponse.json({ id, name: title });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "create_failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  if (body.action === "select") {
    const id = (body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }
    // Best-effort : on garantit que l'onglet attendu existe sur le sheet lié.
    try {
      const sheets = getSheetsFor(me.refreshToken);
      await ensureSheet({ sheets, spreadsheetId: id, title: tab, headers });
    } catch {
      // Si on n'a pas le droit/sheet introuvable, on persiste quand même le
      // choix : la route orders/contacts gèrera l'erreur au prochain accès.
    }
    await persist(id);
    return NextResponse.json({ id });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
