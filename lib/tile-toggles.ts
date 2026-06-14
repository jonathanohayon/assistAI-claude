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
import { getSetting, setSetting } from "@/lib/settings";

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
  const raw = await getSetting(TILE_TOGGLES_SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ToggleMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getTileToggles(userId: string): Promise<TileToggles> {
  const map = await readMap();
  return { ...DEFAULT_TILE_TOGGLES, ...(map[userId] ?? {}) };
}

export async function setTileToggles(
  userId: string,
  toggles: Partial<TileToggles>,
): Promise<TileToggles> {
  const map = await readMap();
  const next: TileToggles = {
    ...DEFAULT_TILE_TOGGLES,
    ...(map[userId] ?? {}),
    ...toggles,
  };
  map[userId] = next;
  await setSetting(TILE_TOGGLES_SETTING, JSON.stringify(map));
  return next;
}
