/**
 * Jetons d'agent — l'URL publique du webhook d'un tenant.
 *
 * Volontairement SÉPARÉ de `lib/api-keys` : la clé API v1 ouvre l'accès aux
 * transcripts. Coller une URL contenant cette clé dans un service tiers
 * (tamaravox, ou n'importe quel outil de test) lui donnerait au passage le
 * droit de lire les conversations du tenant. Le jeton d'agent ne permet
 * qu'une chose : faire parler l'agent.
 *
 * Contrairement à la clé API, il est stocké EN CLAIR et réaffichable : c'est
 * une URL qu'on recopie, pas un secret qu'on saisit une fois. Même modèle que
 * les webhooks Slack ou Discord — la protection vient de la capacité à le
 * régénérer, pas du secret du stockage.
 *
 * Stockage sans migration, dans `app_settings`, comme les clés API.
 */
import { randomBytes } from "node:crypto";

import { getSetting, setSetting } from "@/lib/settings";

const SETTING = "tenant_agent_tokens";

/** Préfixe lisible : reconnaître un jeton d'agent Tamara dans des logs tiers. */
const PREFIX = "agt_";

type TokenMap = Record<string, { userId: string; createdAt: string }>;

async function readMap(): Promise<TokenMap> {
  const raw = await getSetting(SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as TokenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(map: TokenMap): Promise<void> {
  await setSetting(SETTING, JSON.stringify(map));
}

/** Jeton actif d'un tenant, ou null s'il n'en a jamais généré. */
export async function getAgentToken(userId: string): Promise<string | null> {
  const map = await readMap();
  for (const [token, entry] of Object.entries(map)) {
    if (entry.userId === userId) return token;
  }
  return null;
}

/**
 * Génère un jeton pour `userId` et révoque le précédent — un seul actif à la
 * fois, pour que régénérer coupe réellement l'accès de l'ancienne URL.
 */
export async function generateAgentToken(userId: string): Promise<string> {
  const map = await readMap();
  for (const [token, entry] of Object.entries(map)) {
    if (entry.userId === userId) delete map[token];
  }
  const token = `${PREFIX}${randomBytes(18).toString("hex")}`;
  map[token] = { userId, createdAt: new Date().toISOString() };
  await writeMap(map);
  return token;
}

/** Renvoie le jeton existant, ou en crée un à la volée. */
export async function ensureAgentToken(userId: string): Promise<string> {
  return (await getAgentToken(userId)) ?? (await generateAgentToken(userId));
}

/** Résout le tenant depuis un jeton d'URL. null si inconnu ou révoqué. */
export async function resolveAgentToken(
  rawToken: string,
): Promise<string | null> {
  const token = rawToken.trim();
  if (!token.startsWith(PREFIX)) return null;
  const map = await readMap();
  return map[token]?.userId ?? null;
}

export async function revokeAgentToken(userId: string): Promise<void> {
  const map = await readMap();
  for (const [token, entry] of Object.entries(map)) {
    if (entry.userId === userId) delete map[token];
  }
  await writeMap(map);
}
