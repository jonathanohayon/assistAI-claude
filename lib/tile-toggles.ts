/**
 * Toggles par tenant des capacités exposées à l'agent vocal, pilotés depuis
 * les tuiles de l'onglet CRM (Calendrier / Clients / Commandes).
 *
 * Stockés SANS migration dans app_settings (clé TILE_TOGGLES_SETTING = JSON
 * map { [userId]: { calendar, customers, orders } }).
 *
 * Sémantique : un toggle ne peut que DÉSACTIVER ce que le plan autorise. Les
 * features effectives envoyées au worker = (feature du plan) ET (toggle). Le
 * worker n'enregistre alors plus les tools correspondants, et le prompt
 * (api/agent/config) annonce la capacité comme désactivée.
 *
 * Défauts : calendar/customers = ACTIVÉS (comportement historique) ; orders =
 * DÉSACTIVÉ (opt-in — la prise de commandes au téléphone est un nouveau
 * comportement qui n'apparaît que si le tenant l'active).
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";

const TILE_TOGGLES_SETTING = "tenant_tile_toggles";

export interface TileToggles {
  calendar: boolean;
  customers: boolean;
  orders: boolean;
}

export const DEFAULT_TILE_TOGGLES: TileToggles = {
  calendar: true,
  customers: true,
  orders: false,
};

type ToggleMap = Record<string, Partial<TileToggles>>;

async function readMap(): Promise<ToggleMap> {
  return parseMap(await getSetting(TILE_TOGGLES_SETTING));
}

export async function getTileToggles(userId: string): Promise<TileToggles> {
  const map = await readMap();
  return { ...DEFAULT_TILE_TOGGLES, ...(map[userId] ?? {}) };
}

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function parseMap(raw: string | null | undefined): ToggleMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ToggleMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Writes one tenant's toggles INSIDE a transaction: the shared JSON map row
 * is locked (FOR UPDATE), so two concurrent writes can't lose each other's
 * tenant, and a Tools write (T3) commits toggles + tools together.
 */
export async function setTileTogglesIn(
  tx: DbTx,
  userId: string,
  toggles: Partial<TileToggles>,
): Promise<TileToggles> {
  await tx.insert(appSettings).values({ key: TILE_TOGGLES_SETTING, value: "{}" }).onConflictDoNothing();
  const [row] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, TILE_TOGGLES_SETTING))
    .for("update");
  const map = parseMap(row?.value);
  const next: TileToggles = { ...DEFAULT_TILE_TOGGLES, ...(map[userId] ?? {}), ...toggles };
  map[userId] = next;
  await tx
    .update(appSettings)
    .set({ value: JSON.stringify(map), updatedAt: sql`now()` })
    .where(eq(appSettings.key, TILE_TOGGLES_SETTING));
  return next;
}

export async function setTileToggles(userId: string, toggles: Partial<TileToggles>): Promise<TileToggles> {
  return db.transaction((tx) => setTileTogglesIn(tx, userId, toggles));
}
