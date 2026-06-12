/**
 * Clés API tenant-scoped pour l'API publique v1 (app journal externe).
 *
 * Stockage SANS migration : la map { sha256(key) → {userId, createdAt, prefix} }
 * est persistée en JSON dans `app_settings` sous la clé API_KEYS_SETTING. On ne
 * stocke JAMAIS la clé en clair — uniquement son hash SHA-256. La clé complète
 * n'est affichée qu'UNE fois, au moment de la génération.
 *
 * Une seule clé active par tenant : régénérer révoque la précédente.
 */
import { createHash, randomBytes } from "node:crypto";

import { getSetting, setSetting } from "@/lib/settings";

const API_KEYS_SETTING = "tenant_api_keys";

/** Préfixe lisible — aide à reconnaître une clé Tamara dans les logs externes. */
const KEY_PREFIX = "tmr_";

interface ApiKeyEntry {
  userId: string;
  createdAt: string;
  /** 8 premiers caractères de la clé (après le préfixe) — affichage masqué. */
  prefix: string;
}

type ApiKeyMap = Record<string, ApiKeyEntry>;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function readMap(): Promise<ApiKeyMap> {
  const raw = await getSetting(API_KEYS_SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ApiKeyMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(map: ApiKeyMap): Promise<void> {
  await setSetting(API_KEYS_SETTING, JSON.stringify(map));
}

/**
 * Génère une nouvelle clé pour `userId`, révoque l'éventuelle clé précédente,
 * et renvoie la clé EN CLAIR (à afficher une seule fois) + ses métadonnées.
 */
export async function generateApiKey(
  userId: string,
): Promise<{ key: string; prefix: string; createdAt: string }> {
  const map = await readMap();
  // Révoque toute clé existante de ce tenant (une seule active à la fois).
  for (const [hash, entry] of Object.entries(map)) {
    if (entry.userId === userId) delete map[hash];
  }
  const key = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  const prefix = key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8);
  const createdAt = new Date().toISOString();
  map[sha256(key)] = { userId, createdAt, prefix };
  await writeMap(map);
  return { key, prefix, createdAt };
}

/** Révoque la clé du tenant (sans en regénérer). */
export async function revokeApiKey(userId: string): Promise<void> {
  const map = await readMap();
  let changed = false;
  for (const [hash, entry] of Object.entries(map)) {
    if (entry.userId === userId) {
      delete map[hash];
      changed = true;
    }
  }
  if (changed) await writeMap(map);
}

/** Métadonnées de la clé active du tenant (sans la clé en clair), ou null. */
export async function getApiKeyMeta(
  userId: string,
): Promise<{ prefix: string; createdAt: string } | null> {
  const map = await readMap();
  const entry = Object.values(map).find((e) => e.userId === userId);
  return entry ? { prefix: entry.prefix, createdAt: entry.createdAt } : null;
}

/**
 * Vérifie une clé API présentée par un consommateur. Renvoie le userId du
 * tenant propriétaire, ou null si la clé est invalide/inconnue.
 */
export async function resolveApiKey(rawKey: string): Promise<string | null> {
  const key = rawKey.trim();
  if (!key.startsWith(KEY_PREFIX)) return null;
  const map = await readMap();
  return map[sha256(key)]?.userId ?? null;
}

/** Extrait la clé d'une requête : `Authorization: Bearer <key>` ou `x-api-key`. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x?.trim() || null;
}
