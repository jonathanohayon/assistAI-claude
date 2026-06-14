import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { getTenantGoogleClients } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import { ensureSheet, forceTextPhone, prependRow } from "@/lib/sheets-helpers";
import { resolveTenantByPhone, resolveTenantByUserId } from "@/lib/tenant";
import { getOrdersSheetId } from "@/lib/tenant-sheets";
import { getTileToggles } from "@/lib/tile-toggles";

// Enregistre une commande/réservation prise par l'agent au téléphone dans le
// Google Sheet "Commandes" du tenant. Appelé par le tool worker `record_order`
// (gated par ordersEnabled dans /api/agent/config). Auth machine-to-machine
// (x-internal-secret) + routing tenant via x-tenant-phone / x-tenant-user-id.
//
// Onglet "Commandes" : date · heure · nom · téléphone · description · centre.

const ORDERS_TAB = "Commandes";
const ORDERS_HEADERS = [
  "date",
  "heure",
  "nom",
  "téléphone",
  "description",
  "centre",
];

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<{
    name?: string;
    phone?: string;
    description?: string;
    item?: string;
    quantity?: number | string;
    center?: string;
    date?: string;
    time?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  // Routing tenant (mêmes headers que les autres tools agent).
  const phoneHeader = req.headers.get("x-tenant-phone");
  const userIdHeader = req.headers.get("x-tenant-user-id");
  const tenant = userIdHeader
    ? await resolveTenantByUserId(userIdHeader)
    : phoneHeader
      ? await resolveTenantByPhone(phoneHeader)
      : null;
  if (!tenant) {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
  }
  const userId = tenant.user.id;

  // Sécurité : on respecte le toggle même si le worker a appelé par erreur.
  const toggles = await getTileToggles(userId);
  if (!toggles.orders) {
    return NextResponse.json({ error: "orders_disabled" }, { status: 403 });
  }

  const clients = await getTenantGoogleClients(userId);
  if (!clients) {
    return NextResponse.json({ error: "google_not_connected" }, { status: 409 });
  }
  const spreadsheetId = await getOrdersSheetId(userId);
  if (!spreadsheetId) {
    return NextResponse.json({ error: "no_orders_sheet" }, { status: 400 });
  }

  // Description = détails de la commande composés à partir des champs fournis.
  const qty =
    b.quantity != null && `${b.quantity}`.trim() ? `${b.quantity}× ` : "";
  const description =
    (b.description ?? "").trim() ||
    `${qty}${(b.item ?? "").trim()}`.trim() ||
    "Commande";
  const name = (b.name ?? "").trim() || "Client";
  const phone = (b.phone ?? phoneHeader ?? "").trim();

  const nowJer = new Date().toLocaleString("fr-FR", {
    timeZone: "Asia/Jerusalem",
  });
  const [datePart, timePart] = nowJer.split(" ");
  const date = (b.date ?? "").trim() || datePart || "";
  const time = (b.time ?? "").trim() || (timePart ?? "").slice(0, 5);

  try {
    const tabId = await ensureSheet({
      sheets: clients.sheets,
      spreadsheetId,
      title: ORDERS_TAB,
      headers: ORDERS_HEADERS,
    });
    await prependRow({
      sheets: clients.sheets,
      spreadsheetId,
      sheetId: tabId,
      sheetTitle: ORDERS_TAB,
      newRow: [
        date,
        time,
        name,
        forceTextPhone(phone),
        description,
        (b.center ?? "").trim(),
      ],
    });
    await logEvent({
      source: "sheets",
      event: "order_recorded",
      message: `Commande enregistrée : ${name} · ${description}`,
      userId,
      metadata: { name, phone, description, center: b.center },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "orders_sheet_error";
    await logEvent({
      source: "sheets",
      event: "order_failed",
      message: `Enregistrement commande échoué : ${msg.slice(0, 200)}`,
      level: "error",
      userId,
      metadata: { error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
