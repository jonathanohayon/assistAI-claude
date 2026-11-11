// The client agent secret at rest (E1). tools_config.clientAgent.secret may
// hold a plain value (before E1, or no SECRETS_KEY) or a sealed one
// (lib/crypto/secret-box.ts). Writes seal ONLY a secret the patch provides
// (the kept one stays as stored: E1 rewrites no existing secret); serving
// opens it, and an unreadable one means the client agent is NOT served.
import { isSealed, openSecret, sealedSecretRefusal, sealForStorage } from "@/lib/crypto/secret-box";
import { reportUnreadableSecret, type UnreadableReporter } from "@/lib/crypto/unreadable-secret";
import type { Tools } from "@/lib/tools/contract";

type Env = Record<string, string | undefined>;

/** The secret a tools patch sets: a string, null (clear) or undefined (keep). */
export function providedClientAgentSecret(patch: unknown): string | null | undefined {
  const ca = patch && typeof patch === "object" ? (patch as Record<string, unknown>).clientAgent : undefined;
  if (!ca || typeof ca !== "object" || !("secret" in ca)) return undefined;
  const s = (ca as Record<string, unknown>).secret;
  return typeof s === "string" || s === null ? s : undefined;
}

/** A patch may not send a value in the sealed format (it would read as an unreadable secret). */
export function clientAgentSecretRefused(patch: unknown) {
  return sealedSecretRefusal(providedClientAgentSecret(patch), "tools.clientAgent.secret");
}

/** The Tools value to STORE: the secret the patch provided is sealed when SECRETS_KEY is set. */
export function sealClientAgentSecretWrite(tools: Tools, patch: unknown, env: Env = process.env): Tools {
  const provided = providedClientAgentSecret(patch);
  const secret = tools.clientAgent.secret;
  if (typeof provided !== "string" || secret === null || isSealed(secret)) return tools;
  return { ...tools, clientAgent: { ...tools.clientAgent, secret: sealForStorage(secret, env) } };
}

/** The Tools value to SERVE: the secret opened, or `unreadable` (then reported, secret dropped). */
export function openClientAgentTools(
  tools: Tools,
  report: UnreadableReporter = reportUnreadableSecret,
  env: Env = process.env,
): { tools: Tools; unreadable: boolean } {
  const stored = tools.clientAgent.secret;
  if (!stored || !isSealed(stored)) return { tools, unreadable: false };
  const r = openSecret(stored, env);
  if (r.ok) return { tools: { ...tools, clientAgent: { ...tools.clientAgent, secret: r.value } }, unreadable: false };
  report("client_agent", r.reason);
  return { tools: { ...tools, clientAgent: { ...tools.clientAgent, secret: null } }, unreadable: true };
}
