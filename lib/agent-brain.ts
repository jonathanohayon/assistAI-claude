/**
 * Cerveau de l'agent, par tenant : sa persona Tamara, ou son propre agent
 * externe (BYO).
 *
 * Quand un tenant active le mode externe, le modèle Realtime cesse d'être le
 * cerveau : il transcrit, POSTe chaque tour au endpoint du tenant, et prononce
 * la réponse. La persona configurée dans le dashboard n'est alors plus
 * utilisée — c'est l'agent du tenant qui décide quoi dire.
 *
 * Stocké SANS migration dans app_settings, comme les toggles de tuiles.
 *
 * `enabled` est distinct de la présence d'une URL : on veut pouvoir couper le
 * mode externe pour revenir à la persona sans perdre l'URL configurée. Un
 * tenant qui débranche son agent pour déboguer ne doit pas avoir à la
 * retrouver.
 */
import { getSetting, setSetting } from "@/lib/settings";

const SETTING = "tenant_agent_brain";

export interface AgentBrain {
  /** true = l'agent externe répond ; false = persona Tamara (défaut). */
  enabled: boolean;
  /** Endpoint du tenant. HTTPS attendu en production. */
  url: string;
  /** Secret HMAC optionnel — signe les requêtes pour que le tenant les vérifie. */
  secret?: string;
}

export const DEFAULT_AGENT_BRAIN: AgentBrain = { enabled: false, url: "" };

type BrainMap = Record<string, Partial<AgentBrain>>;

async function readMap(): Promise<BrainMap> {
  const raw = await getSetting(SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as BrainMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getAgentBrain(userId: string): Promise<AgentBrain> {
  const map = await readMap();
  const entry = map[userId];
  return {
    enabled: entry?.enabled === true,
    url: typeof entry?.url === "string" ? entry.url : "",
    ...(typeof entry?.secret === "string" && entry.secret
      ? { secret: entry.secret }
      : {}),
  };
}

export async function setAgentBrain(
  userId: string,
  next: AgentBrain,
): Promise<AgentBrain> {
  const map = await readMap();
  const url = next.url.trim();
  // On refuse d'activer sans cible : un mode externe activé sans URL
  // enverrait chaque tour dans le vide, et l'appelant n'entendrait que la
  // phrase d'attente sans qu'aucun réglage n'ait l'air faux.
  const enabled = next.enabled && url.startsWith("http");
  map[userId] = {
    enabled,
    url,
    ...(next.secret?.trim() ? { secret: next.secret.trim() } : {}),
  };
  await setSetting(SETTING, JSON.stringify(map));
  return getAgentBrain(userId);
}

/**
 * Bloc `agentWebhook` à renvoyer au worker, ou undefined si ce tenant doit
 * garder sa persona. Le worker ne bascule que sur présence de ce bloc.
 */
export function toWorkerWebhook(
  brain: AgentBrain,
): { url: string; secret?: string } | undefined {
  if (!brain.enabled || !brain.url.startsWith("http")) return undefined;
  return {
    url: brain.url,
    ...(brain.secret ? { secret: brain.secret } : {}),
  };
}
