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
import { randomBytes } from "node:crypto";

import { openSecret, sealForStorage } from "@/lib/crypto/secret-box";
import { reportUnreadableSecret, type UnreadableReporter } from "@/lib/crypto/unreadable-secret";
import { getSetting, setSetting } from "@/lib/settings";

const SETTING = "tenant_agent_brain";

export interface AgentBrain {
  /** true = l'agent externe répond ; false = persona Tamara (défaut). */
  enabled: boolean;
  /** Endpoint du tenant. HTTPS attendu en production. */
  url: string;
  /** Secret HMAC optionnel — signe les requêtes pour que le tenant les vérifie. */
  secret?: string;
  /**
   * E1: a secret IS stored but can't be opened (sealed, key missing/wrong).
   * The webhook is then NOT served (toWorkerWebhook); the screen still shows
   * "secret set" (it is stored); the admins got one alert.
   */
  secretUnreadable?: true;
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

/**
 * The brain as stored, the secret OPENED (E1: plain or sealed both read).
 * A sealed secret that can't be opened is never returned: `secretUnreadable`.
 */
export function brainFromEntry(
  entry: Partial<AgentBrain> | undefined,
  report: UnreadableReporter = reportUnreadableSecret,
  env: Record<string, string | undefined> = process.env,
): AgentBrain {
  const base = {
    enabled: entry?.enabled === true,
    url: typeof entry?.url === "string" ? entry.url : "",
  };
  const stored = typeof entry?.secret === "string" && entry.secret ? entry.secret : null;
  if (!stored) return base;
  const opened = openSecret(stored, env);
  if (opened.ok) return { ...base, secret: opened.value };
  report("agent_brain", opened.reason);
  return { ...base, secretUnreadable: true };
}

export async function getAgentBrain(userId: string): Promise<AgentBrain> {
  const map = await readMap();
  return brainFromEntry(map[userId]);
}

/**
 * Secret to store for a tenant's external agent. An explicit value wins;
 * otherwise the existing one is kept (the dashboard never sends it, so every
 * save used to erase it); otherwise one is generated as soon as the external
 * agent is enabled. Unsigned requests leave the tenant unable to tell ours
 * from anyone's.
 */
export function nextBrainSecret(args: {
  existing: string | undefined;
  provided: string | undefined;
  enabled: boolean;
  generate?: () => string;
}): string | undefined {
  const provided = args.provided?.trim();
  if (provided) return provided;
  if (args.existing) return args.existing;
  if (!args.enabled) return undefined;
  return (args.generate ?? (() => randomBytes(24).toString("hex")))();
}

/** E1: a NEW secret (provided or generated) is sealed when SECRETS_KEY is set; the kept one stays as stored. */
export function storedBrainSecret(
  secret: string,
  existing: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return secret === existing ? existing : sealForStorage(secret, env);
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
  // The STORED value (plain or sealed) is what "keep the existing" keeps:
  // never opened and re-written here (E1 rewrites no existing secret).
  const existing = typeof map[userId]?.secret === "string" && map[userId]?.secret ? map[userId]?.secret : undefined;
  const secret = nextBrainSecret({ existing, provided: next.secret, enabled });
  map[userId] = {
    enabled,
    url,
    ...(secret ? { secret: storedBrainSecret(secret, existing) } : {}),
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
  // E1 fail closed: a stored secret we can't open → not served (Tamara answers).
  if (brain.secretUnreadable) return undefined;
  return {
    url: brain.url,
    ...(brain.secret ? { secret: brain.secret } : {}),
  };
}
