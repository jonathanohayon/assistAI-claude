// Stockage SANS migration de l'ID du Google Sheet "Commandes" par tenant.
//
// Le Sheet "Clients" du tenant vit dans la colonne users.googleSheetId (déjà
// migrée). Pour le Sheet "Commandes" on n'ajoute pas de colonne DB : on le
// range dans app_settings sous une seule clé JSON `tenant_orders_sheets`
// = { [userId]: spreadsheetId }. Lecture/écriture via getSetting/setSetting
// (lib/settings.ts), en réutilisant le pattern read-modify-write des autres
// maps JSON pour ne jamais écraser les autres tenants.

import { getSetting, setSetting } from "@/lib/settings";

const ORDERS_SHEETS_KEY = "tenant_orders_sheets";

type OrdersSheetMap = Record<string, string>;

/** Parse la map JSON ; JSON corrompu ou absent → map vide (jamais de throw). */
async function readMap(): Promise<OrdersSheetMap> {
  const raw = await getSetting(ORDERS_SHEETS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: OrdersSheetMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // JSON corrompu → on repart d'une map vide.
  }
  return {};
}

/** ID du spreadsheet "Commandes" du tenant, ou null si non configuré. */
export async function getOrdersSheetId(userId: string): Promise<string | null> {
  const map = await readMap();
  const id = map[userId]?.trim();
  return id ? id : null;
}

/** Persiste l'ID du spreadsheet "Commandes" pour ce tenant (read-modify-write). */
export async function setOrdersSheetId(
  userId: string,
  sheetId: string,
): Promise<void> {
  const map = await readMap();
  map[userId] = sheetId;
  await setSetting(ORDERS_SHEETS_KEY, JSON.stringify(map));
}
