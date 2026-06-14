import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { getTenantGoogleClients } from "@/lib/google";
import { parseEventContact } from "@/lib/reminders";
import { ensureSheet } from "@/lib/sheets-helpers";
import { getOrdersSheetId } from "@/lib/tenant-sheets";
import { JERUSALEM_TZ } from "@/lib/tz";

export const dynamic = "force-dynamic";

// Réservations (= "commandes") du tenant. La source de vérité reste Google
// Calendar : chaque RDV pris par l'agent est un event créé par
// /api/calendar/book (summary "RDV <centre> — <nom>", description "Centre : …"
// + "Tel : …"). On réutilise parseEventContact (lib/reminders) — exactement la
// même extraction que le cron J-1 — pour reconstruire la fiche commande.
//
// GET  → liste des réservations (fenêtre J-30 → J+90, triée par date).
// POST → synchronise ces réservations dans le Google Sheet "Commandes".

const ORDERS_TAB = "Commandes";
const ORDERS_HEADERS = [
  "date",
  "heure",
  "nom",
  "téléphone",
  "description",
  "centre",
];

interface Order {
  id: string;
  name: string;
  phone: string;
  description: string;
  center: string;
  start: string; // ISO
  date: string; // YYYY-MM-DD (Asia/Jerusalem)
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: JERUSALEM_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: JERUSALEM_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type GoogleClients = NonNullable<
  Awaited<ReturnType<typeof getTenantGoogleClients>>
>;

// Lit les commandes directement depuis le Google Sheet "Commandes" connecté
// (la "vérité" pour le tenant : ce qu'il voit dans SON fichier — agent
// record_order + export agenda). Onglet date/heure/nom/téléphone/description/centre.
async function readOrdersSheet(
  g: GoogleClients,
  sheetId: string,
): Promise<Order[]> {
  await ensureSheet({
    sheets: g.sheets,
    spreadsheetId: sheetId,
    title: ORDERS_TAB,
    headers: ORDERS_HEADERS,
  });
  const res = await g.sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${ORDERS_TAB}!A2:F`,
  });
  const rows = (res.data.values ?? []) as string[][];
  const orders: Order[] = rows
    .filter((row) => row.some((c) => (c ?? "").trim()))
    .map((row, i) => {
      const [d = "", h = "", name = "", phone = "", description = "", center = ""] =
        row;
      const start = d && h ? `${d}T${h}:00` : d ? `${d}T00:00:00` : "";
      return {
        id: `sheet-${i}`,
        name: String(name),
        phone: String(phone).replace(/^'/, ""),
        description: String(description),
        center: String(center),
        start,
        date: start || String(d),
      };
    });
  // Plus récentes d'abord.
  orders.sort((a, b) => b.start.localeCompare(a.start));
  return orders;
}

// Construit la fenêtre de lecture et lit les events du calendrier du tenant.
async function fetchOrdersFromCalendar(g: GoogleClients): Promise<Order[]> {
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const res = await g.calendar.events.list({
    calendarId: g.calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: JERUSALEM_TZ,
    maxResults: 250,
  });

  const orders: Order[] = (res.data.items ?? [])
    .filter((e) => e.id && e.start?.dateTime)
    .map((e) => {
      const start = e.start?.dateTime ?? "";
      const { name, phone, center } = parseEventContact({
        summary: e.summary,
        description: e.description,
      });
      // 1re ligne de la description = prestation/description libre.
      const description = (e.description ?? "").split("\n")[0]?.trim() ?? "";
      return {
        id: e.id as string,
        name,
        phone: phone ?? "",
        description,
        center,
        start,
        date: start ? dateFmt.format(new Date(start)) : "",
      };
    });

  // Tri ascendant par date de début (les plus proches d'abord).
  orders.sort((a, b) => a.start.localeCompare(b.start));
  return orders;
}

// Source des commandes : si un Sheet "Commandes" est connecté → on lit CE
// fichier (ce que le tenant attend de voir). Sinon → l'agenda (réservations).
async function fetchOrders(
  userId: string,
): Promise<{ orders: Order[]; source: "sheet" | "calendar" } | null> {
  const g = await getTenantGoogleClients(userId);
  if (!g) return null;
  const ordersSheetId = await getOrdersSheetId(userId);
  if (ordersSheetId) {
    try {
      return { orders: await readOrdersSheet(g, ordersSheetId), source: "sheet" };
    } catch {
      /* Sheet inaccessible (droits/suppression) → fallback agenda. */
    }
  }
  return { orders: await fetchOrdersFromCalendar(g), source: "calendar" };
}

export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await fetchOrders(r.userId);
  if (result === null) {
    return NextResponse.json(
      { error: "google_not_connected" },
      { status: 409 },
    );
  }
  return NextResponse.json({ orders: result.orders, source: result.source });
}

export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const g = await getTenantGoogleClients(r.userId);
  if (!g) {
    return NextResponse.json(
      { error: "google_not_connected" },
      { status: 409 },
    );
  }

  const sheetId = await getOrdersSheetId(r.userId);
  if (!sheetId) {
    return NextResponse.json({ error: "no_orders_sheet" }, { status: 400 });
  }

  // Export = snapshot des réservations de l'AGENDA vers le Sheet (et non une
  // relecture du Sheet, ce que ferait fetchOrders quand un Sheet est lié).
  const orders = await fetchOrdersFromCalendar(g);

  // Stratégie simple et déterministe : on (ré)écrit tout l'onglet. ensureSheet
  // garantit l'existence du tab + des en-têtes, puis on remplace les lignes de
  // données par un snapshot frais du calendrier. Évite la dérive d'un upsert
  // partiel quand un RDV est annulé/modifié côté agenda.
  await ensureSheet({
    sheets: g.sheets,
    spreadsheetId: sheetId,
    title: ORDERS_TAB,
    headers: ORDERS_HEADERS,
  });

  // Vide les anciennes données (on garde la ligne d'en-têtes).
  await g.sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${ORDERS_TAB}!A2:F`,
  });

  if (orders.length > 0) {
    const values = orders.map((o) => [
      o.date,
      o.start ? timeFmt.format(new Date(o.start)) : "",
      o.name,
      o.phone,
      o.description,
      o.center,
    ]);
    await g.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${ORDERS_TAB}!A2:F${orders.length + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }

  return NextResponse.json({ ok: true, count: orders.length });
}
