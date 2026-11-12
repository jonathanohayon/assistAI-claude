/**
 * Agent tokens — the secret in a tenant's public agent webhook URL
 * (`/api/v1/agent/<token>`).
 *
 * Deliberately SEPARATE from `lib/api-keys`: the v1 API key opens the
 * transcripts. Pasting a URL carrying that key into a third-party service
 * would also let it read the tenant's conversations. An agent token only lets
 * the holder make the agent speak.
 *
 * Storage model (same as the API key):
 *   - The token is shown ONCE, in the response of the call that creates or
 *     regenerates it. It is never stored in clear and never returned again.
 *   - What is stored is sha256(token) in hex, as the key of a JSON map in
 *     `app_settings` ("tenant_agent_tokens"):
 *       { "<sha256 hex>": { userId, createdAt, hint } }
 *     `hint` ("agt_…1a2b") is the only thing the dashboard can display.
 *   - Authentication hashes the presented token and does one map lookup: no
 *     loop comparing secrets, so no meaningful timing signal.
 *
 * Legacy: before this change the token itself was the map key, in clear
 * ("agt_…" keys). Those URLs are pasted in third-party services and must keep
 * working, so resolution is a DUAL READ: sha256(token) as a key, OR the plain
 * token as a key. A successful legacy match migrates that entry to the hashed
 * form (same userId and createdAt), so a legacy token stops being stored in
 * clear the first time it is used. The two key spaces cannot collide: hashed
 * keys are 64 hex characters, legacy keys start with "agt_".
 *
 * Concurrency: the map is one app_settings row. Every write (create,
 * regenerate, revoke, legacy migration) is ONE SQL statement working on the
 * stored jsonb (pattern of lib/alert-ledger.ts), so Postgres serialises them
 * on the row lock: two regenerates, or a regenerate racing a legacy
 * migration, cannot lose another tenant's entry or resurrect a revoked token.
 *
 * Never log a token.
 */
import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const AGENT_TOKENS_SETTING = "tenant_agent_tokens";

/** Readable prefix: recognise a Tamara agent token in third-party logs. */
const PREFIX = "agt_";

/** Format of every token ever generated (legacy included): agt_ + 36 hex. */
const TOKEN_RE = /^agt_[0-9a-f]{36}$/;

export interface AgentTokenEntry {
  userId: string;
  createdAt: string;
  /** "agt_…" + last 4 characters. Absent on legacy entries. */
  hint?: string;
}

export type AgentTokenMap = Record<string, AgentTokenEntry>;

/** Non-secret view of a tenant's token: what the dashboard GET returns. */
export interface AgentTokenStatus {
  exists: boolean;
  createdAt: string | null;
  hint: string | null;
}

/**
 * Persistence of the map. Every method is atomic with respect to the others.
 * The Postgres store is the default; tests inject an in-memory one.
 */
export interface AgentTokenStore {
  read(): Promise<AgentTokenMap>;
  /** Removes every entry of `userId` (legacy or hashed) and adds `hash`. */
  replaceForUser(userId: string, hash: string, entry: AgentTokenEntry): Promise<void>;
  /** Removes every entry of `userId` (legacy or hashed). */
  removeForUser(userId: string): Promise<void>;
  /**
   * Moves the legacy entry `plain` to `hash`, adding `hint`, only if `plain`
   * is still stored (a concurrent regenerate wins; nothing is resurrected).
   */
  migrateLegacy(plain: string, hash: string, hint: string): Promise<void>;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function agentTokenHint(token: string): string {
  return `${PREFIX}…${token.slice(-4)}`;
}

const isLegacyKey = (key: string) => key.startsWith(PREFIX);

function parseMap(raw: string | null): AgentTokenMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AgentTokenMap)
      : {};
  } catch {
    return {};
  }
}

// ── Postgres store ──────────────────────────────────────────────────────────

/** The stored value as a jsonb object ('{}' if it is any other JSON type). */
const stored = sql`(CASE WHEN jsonb_typeof(s.value::jsonb) = 'object' THEN s.value::jsonb ELSE '{}'::jsonb END)`;

/** The stored map without any entry of `userId`. */
const withoutUser = (userId: string) => sql`COALESCE(
  (SELECT jsonb_object_agg(e.key, e.value)
     FROM jsonb_each(${stored}) e
    WHERE NOT (jsonb_typeof(e.value) = 'object' AND e.value ->> 'userId' = ${userId}::text)),
  '{}'::jsonb)`;

/**
 * Runs `write`; if it throws because the stored value is not valid JSON (the
 * ::jsonb cast), resets it to '{}' with a compare-and-swap on the exact bad
 * text, then retries once. The old code read corrupt JSON as an empty map.
 */
async function withCorruptRepair(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    const raw = await getSetting(AGENT_TOKENS_SETTING);
    let corrupt = false;
    if (raw !== null) {
      try {
        JSON.parse(raw);
      } catch {
        corrupt = true;
      }
    }
    if (!corrupt) throw e;
    await db.execute(sql`
      UPDATE app_settings SET value = '{}', updated_at = now()
       WHERE key = ${AGENT_TOKENS_SETTING} AND value = ${raw}
    `);
    await write();
  }
}

export const pgAgentTokenStore: AgentTokenStore = {
  async read() {
    return parseMap(await getSetting(AGENT_TOKENS_SETTING));
  },

  async replaceForUser(userId, hash, entry) {
    const add = sql`jsonb_build_object(${hash}::text, ${JSON.stringify(entry)}::jsonb)`;
    await withCorruptRepair(() =>
      db.execute(sql`
        INSERT INTO app_settings AS s (key, value, updated_at)
        VALUES (${AGENT_TOKENS_SETTING}, ${add}::text, now())
        ON CONFLICT (key) DO UPDATE SET
          value = (${withoutUser(userId)} || ${add})::text,
          updated_at = now()
      `),
    );
  },

  async removeForUser(userId) {
    await withCorruptRepair(() =>
      db.execute(sql`
        UPDATE app_settings AS s SET
          value = (${withoutUser(userId)})::text,
          updated_at = now()
        WHERE s.key = ${AGENT_TOKENS_SETTING}
      `),
    );
  },

  async migrateLegacy(plain, hash, hint) {
    // Single statement: the WHERE re-evaluates after a concurrent writer
    // commits, so a regenerate that already removed `plain` makes this a no-op.
    await db.execute(sql`
      UPDATE app_settings AS s SET
        value = ((${stored} - ${plain}::text)
                 || jsonb_build_object(${hash}::text,
                      (${stored} -> ${plain}::text) || jsonb_build_object('hint', ${hint}::text)))::text,
        updated_at = now()
      WHERE s.key = ${AGENT_TOKENS_SETTING}
        AND jsonb_typeof(${stored} -> ${plain}::text) = 'object'
    `);
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

function findUserEntry(map: AgentTokenMap, userId: string): [string, AgentTokenEntry] | null {
  for (const [key, entry] of Object.entries(map)) {
    if (entry && typeof entry === "object" && entry.userId === userId) return [key, entry];
  }
  return null;
}

/** Non-secret status of a tenant's token. Never contains the token. */
export async function getAgentTokenStatus(
  userId: string,
  store: AgentTokenStore = pgAgentTokenStore,
): Promise<AgentTokenStatus> {
  const found = findUserEntry(await store.read(), userId);
  if (!found) return { exists: false, createdAt: null, hint: null };
  const [key, entry] = found;
  const hint = entry.hint ?? (isLegacyKey(key) ? agentTokenHint(key) : null);
  return { exists: true, createdAt: entry.createdAt ?? null, hint };
}

/**
 * Generates a token for `userId` and revokes the previous one (legacy or
 * hashed): one active token per tenant, so regenerating really cuts the old
 * URL. Returns the plain token — the ONLY time it exists outside the caller's
 * clipboard.
 */
export async function generateAgentToken(
  userId: string,
  store: AgentTokenStore = pgAgentTokenStore,
): Promise<{ token: string; createdAt: string; hint: string }> {
  const token = `${PREFIX}${randomBytes(18).toString("hex")}`;
  const createdAt = new Date().toISOString();
  const hint = agentTokenHint(token);
  await store.replaceForUser(userId, hashAgentToken(token), { userId, createdAt, hint });
  return { token, createdAt, hint };
}

/** Resolves the tenant from a URL token. null if unknown or revoked. */
export async function resolveAgentToken(
  rawToken: string,
  store: AgentTokenStore = pgAgentTokenStore,
): Promise<string | null> {
  const token = rawToken.trim();
  if (!TOKEN_RE.test(token)) return null;
  const map = await store.read();
  const hash = hashAgentToken(token);
  const hashed = Object.hasOwn(map, hash) ? map[hash] : undefined;
  if (hashed?.userId) return hashed.userId;

  const legacy = Object.hasOwn(map, token) ? map[token] : undefined;
  if (!legacy?.userId) return null;
  // Legacy plain entry: stop storing it in clear. A failed migration must not
  // fail the call — the token stays valid and migrates on a later call.
  try {
    await store.migrateLegacy(token, hash, agentTokenHint(token));
  } catch {
    // Deliberately silent: logging here could carry the token.
  }
  return legacy.userId;
}

export async function revokeAgentToken(
  userId: string,
  store: AgentTokenStore = pgAgentTokenStore,
): Promise<void> {
  await store.removeForUser(userId);
}
