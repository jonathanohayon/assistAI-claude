// Connector writes (B4) — SERVER-ONLY. Create / edit / test (delete: its own PR), behind
// CONNECTORS_WRITE (lib/connectors/write-switch.ts, checked by the routes).
// No number purchase or release here (B5), no payment (B6).
//
// Every write locks the account's users row FOR UPDATE first, so two writes
// on one account can't both pass the limit / number checks, nor both
// materialize the legacy agent.
//
// The legacy materialization (lib/connectors/materialize.ts): when the
// account has ZERO rows and an enabled legacy agent, the first write (POST,
// or PATCH on id "legacy") first writes the legacy card as a real row, in
// the SAME transaction; the write must carry acknowledgeLegacyConversion:
// true (409 legacy_conversion_unacknowledged otherwise), so the FE can't skip
// the notice. A refused write rolls the conversion back with it.
//
// Secrets: generated here (#437's generateClientAgentSecret: 32 random
// bytes, base64url), stored sealed
// (lib/crypto/secret-box.ts sealForStorage, E1), returned ONCE as
// `generatedSecret` (create, and a PATCH with rotateSecret: true). Never
// selected otherwise; never logged.

import { and, asc, count, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, connectors, phoneNumbers, users } from "@/lib/db/schema";
import { openStoredSecret } from "@/lib/crypto/unreadable-secret";
import { sealForStorage } from "@/lib/crypto/secret-box";
import { isTamaravoxNumber, type VoxCheck } from "@/lib/connectors/tamaravox-numbers";
import { logEvent } from "@/lib/logger";
import { checkAgentUrl, SAFE_URL_MESSAGE, type CheckOptions } from "@/lib/net/safe-url";
import { ACCOUNT_PRODUCTS_PICK, getCatalogueRow } from "@/lib/products";
import { generateClientAgentSecret } from "@/lib/tools/client-agent-secret";
import { runClientAgentTest, type ClientAgentTestResult } from "@/lib/tools/client-agent-test";
import { parseTools } from "@/lib/tools/store";
import { DEFAULT_VOICE, parseVoice, type Voice } from "@/lib/voice/contract";
import { planVoiceWrite } from "@/lib/voice/store";

import { canAddConnector } from "./entitlement";
import { LEGACY_CONNECTOR_ID } from "./legacy";
import { defaultConnectorLimits } from "./limits";
import { legacyMaterialization, type LegacyRow } from "./materialize";
import { numberConflict } from "./number-exclusivity";
import { loadConnectorsPage } from "./page";
import type { ConnectorCreate, ConnectorPatch } from "./validate";
import { isConnectorUuid } from "./validate";
import type { ConnectorsPageView, ConnectorView } from "./types";

/** Who writes: the target account, and whether the SESSION is an admin (?asUserId or own). */
export type ConnectorActor = { userId: string; sessionIsAdmin: boolean; viaAsUserId: boolean };

export type WriteOutcome =
  | { ok: true; status: 200 | 201; body: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; body: { error: string; fields?: string[]; message?: string; [k: string]: unknown } };

/** Thrown inside a transaction to roll it back with a refusal. */
class Refusal extends Error {
  constructor(readonly outcome: Extract<WriteOutcome, { ok: false }>) {
    super(outcome.body.error);
  }
}
const refuse = (status: Extract<WriteOutcome, { ok: false }>["status"], body: Extract<WriteOutcome, { ok: false }>["body"]): never => {
  throw new Refusal({ ok: false, status, body });
};

/** #437's generator: the same format as the client agent brick (32 random bytes, base64url). */
export const generateConnectorSecret = generateClientAgentSecret;

/** The url's host name only, for event metadata (never the path, query string or userinfo). */
function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const isUniqueNumberViolation = (e: unknown): boolean => {
  const text = e instanceof Error ? `${e.message} ${e.cause instanceof Error ? e.cause.message : ""}` : String(e);
  return /connectors_phone_number_id_unique/.test(text);
};

// The list (and the "first connector" rule) orders by created_at, id. now()
// is the transaction's start: a converted legacy row and the new one written
// in ONE transaction would tie and order by uuid. clock_timestamp() keeps the
// write order: the legacy row stays first.
const CREATED_NOW = sql`clock_timestamp()` as unknown as Date;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** A transaction, or the pool for the unlocked reads before one. */
type Reader = Tx | typeof db;

async function lockAccount(tx: Tx, userId: string) {
  const [account] = await tx
    .select({ ...ACCOUNT_PRODUCTS_PICK, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  return account ?? null;
}

async function rowCount(tx: Reader, userId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(connectors).where(eq(connectors.userId, userId));
  return Number(r?.n ?? 0);
}

/** The legacy row the next write would write, or null (rows exist / no enabled legacy agent). */
async function pendingLegacy(tx: Reader, userId: string, rows: number): Promise<{ row: LegacyRow; numberE164: string | null } | null> {
  if (rows > 0) return null;
  const [[cfg], [main]] = await Promise.all([
    tx.select({ toolsConfig: agentConfigs.toolsConfig }).from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1),
    tx
      .select({ id: phoneNumbers.id, phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, userId))
      .orderBy(asc(phoneNumbers.createdAt), asc(phoneNumbers.id))
      .limit(1),
  ]);
  const row = legacyMaterialization({ connectorRowCount: rows, toolsConfig: cfg?.toolsConfig ?? null, mainNumber: main ?? null });
  return row ? { row, numberE164: main?.phoneNumber ?? null } : null;
}

async function insertLegacy(tx: Tx, userId: string, row: LegacyRow): Promise<string> {
  const [ins] = await tx
    .insert(connectors)
    .values({
      userId,
      name: row.name,
      url: row.url,
      mode: row.mode,
      // The stored value copied as is (sealed or not): nothing re-sealed.
      secret: row.secret,
      voiceConfig: null,
      enabled: true,
      phoneNumberId: row.phoneNumberId,
      createdAt: CREATED_NOW,
    })
    .returning({ id: connectors.id });
  return ins.id;
}

function unacknowledged(numberE164: string | null): never {
  return refuse(409, { error: "legacy_conversion_unacknowledged", legacyConversion: { willConvert: true, numberE164 } });
}

/** A voice patch → the voice to store (null = the account voice), or a refusal. */
function voiceToStore(current: unknown, patch: Record<string, unknown> | null, isAdmin: boolean): Voice | null {
  if (patch === null) return null;
  const parsed = parseVoice(current);
  const plan = planVoiceWrite(parsed.ok ? parsed.value : DEFAULT_VOICE, patch, isAdmin);
  if (!plan.ok) return refuse(plan.status, { error: plan.error, fields: plan.fields });
  return plan.voice;
}

async function urlRefusal(url: string | undefined, check?: CheckOptions): Promise<WriteOutcome | null> {
  if (url === undefined) return null;
  const r = await checkAgentUrl(url, check);
  return r.ok ? null : { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE, fields: ["url"] } };
}

const VOX_UNAVAILABLE: Extract<WriteOutcome, { ok: false }> = {
  ok: false,
  status: 503,
  body: { error: "vox_check_unavailable", message: "Réessayez dans un instant." },
};

/**
 * The tamaravox check (lib/connectors/tamaravox-numbers.ts), BEFORE the
 * transaction: no row lock is held during the HTTP call. Unlocked reads find
 * the numbers this create would put on a connector: the requested one (this
 * account's) and, when the legacy card would convert, its number too (same
 * rule). Any "unavailable" → 503, nothing written (FAIL-CLOSED);
 * "not_configured" = skipped (allowed, alerted inside the check). The
 * transaction then re-reads under the lock and refuses (503) a number that was
 * not checked here (a concurrent change between the two reads).
 */
async function voxPrecheck(userId: string, phoneNumberId: string): Promise<Map<string, VoxCheck> | null> {
  const [num] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.id, phoneNumberId), eq(phoneNumbers.userId, userId)))
    .limit(1);
  const legacy = await pendingLegacy(db, userId, await rowCount(db, userId));
  const e164s = [...new Set([num?.phoneNumber, legacy?.numberE164].filter((x): x is string => !!x))];
  const outcomes = await Promise.all(e164s.map((e) => isTamaravoxNumber(e)));
  if (outcomes.includes("unavailable")) return null;
  return new Map(e164s.map((e, i) => [e, outcomes[i]]));
}

async function run(fn: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Refusal) return e.outcome;
    if (isUniqueNumberViolation(e)) return { ok: false, status: 409, body: { error: "number_in_use" } };
    throw e;
  }
}

const source = (a: ConnectorActor) => (a.viaAsUserId ? ("admin" as const) : ("web" as const));

async function logConverted(a: ConnectorActor, connectorId: string, phoneNumberId: string | null, trigger: "create" | "patch_legacy") {
  await logEvent({
    source: source(a),
    event: "connector_legacy_converted",
    message: "Agent du compte converti en premier connecteur",
    userId: a.userId,
    metadata: { connectorId, phoneNumberId, trigger },
  });
}

async function pageAnd(userId: string, id: string | null): Promise<{ page: ConnectorsPageView | null; connector: ConnectorView | null }> {
  const page = await loadConnectorsPage(userId);
  return { page, connector: id ? (page?.connectors.find((c) => c.id === id) ?? null) : null };
}

// ── POST /api/dashboard/connectors ──────────────────────────────────────

export async function createConnector(a: ConnectorActor, input: ConnectorCreate, check?: CheckOptions): Promise<WriteOutcome> {
  const unsafe = await urlRefusal(input.url, check);
  if (unsafe) return unsafe;
  const checked = await voxPrecheck(a.userId, input.phoneNumberId);
  if (!checked) return VOX_UNAVAILABLE;
  const catalogue = await getCatalogueRow();
  const limits = catalogue.connectorLimits ?? defaultConnectorLimits();
  const secret = generateConnectorSecret();
  let converted: { id: string; phoneNumberId: string | null } | null = null;
  let createdId = "";
  const out = await run(async () => {
    await db.transaction(async (tx) => {
      const account = await lockAccount(tx, a.userId);
      if (!account) refuse(404, { error: "not_found" });
      const rows = await rowCount(tx, a.userId);
      const legacy = await pendingLegacy(tx, a.userId, rows);
      if (legacy && !input.acknowledgeLegacyConversion) unacknowledged(legacy.numberE164);

      // The number: one of THIS account's rows (another account's = not found).
      const [num] = await tx
        .select({ id: phoneNumbers.id, phoneNumber: phoneNumbers.phoneNumber })
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.id, input.phoneNumberId), eq(phoneNumbers.userId, a.userId)))
        .limit(1);
      if (!num) refuse(404, { error: "number_not_found" });
      const [held] = await tx.select({ id: connectors.id }).from(connectors).where(eq(connectors.phoneNumberId, num.id)).limit(1);
      // The numbers checked before the transaction must be the ones written now.
      const written = [num.phoneNumber, legacy?.numberE164].filter((x): x is string => !!x);
      if (written.some((e) => !checked.has(e))) refuse(503, VOX_UNAVAILABLE.body);
      const vox = written.filter((e) => checked.get(e) === "vox");
      const conflict = numberConflict({
        e164: num.phoneNumber,
        connectorNumbers: held || legacy?.row.phoneNumberId === num.id ? [num.phoneNumber] : [],
        tamaravoxNumbers: vox,
      });
      if (conflict === "connector_number") refuse(409, { error: "number_in_use" });
      if (conflict === "tamaravox_number") refuse(409, { error: "tamaravox_number" });
      // The converted legacy card's number: the same rule.
      if (legacy?.numberE164 && vox.includes(legacy.numberE164)) refuse(409, { error: "tamaravox_number" });

      // Limits: the legacy card counts as one (it is about to become a row).
      const can = canAddConnector({ subscriptionStatus: account!.subscriptionStatus, role: account!.role }, rows + (legacy ? 1 : 0), limits);
      if (!can.ok) refuse(409, { error: can.reason! });

      if (legacy) converted = { id: await insertLegacy(tx, a.userId, legacy.row), phoneNumberId: legacy.row.phoneNumberId };
      const voice = input.voiceConfig === undefined ? null : voiceToStore(null, input.voiceConfig, a.sessionIsAdmin);
      const [ins] = await tx
        .insert(connectors)
        .values({
          userId: a.userId,
          name: input.name,
          url: input.url,
          mode: input.mode,
          secret: sealForStorage(secret),
          voiceConfig: voice,
          enabled: input.enabled,
          phoneNumberId: num.id,
          createdAt: CREATED_NOW,
        })
        .returning({ id: connectors.id });
      createdId = ins.id;
    });
    return { ok: true, status: 201, body: {} };
  });
  if (!out.ok) return out;
  const c = converted as { id: string; phoneNumberId: string | null } | null;
  if (c) await logConverted(a, c.id, c.phoneNumberId, "create");
  await logEvent({
    source: source(a),
    event: "connector_created",
    message: "Connecteur créé",
    userId: a.userId,
    metadata: { connectorId: createdId, phoneNumberId: input.phoneNumberId, mode: input.mode, host: safeHost(input.url) },
  });
  const { page, connector } = await pageAnd(a.userId, createdId);
  return {
    ok: true,
    status: 201,
    body: { connector, generatedSecret: secret, ...(c ? { legacyConvertedId: c.id } : {}), page },
  };
}

// ── PATCH /api/dashboard/connectors/[id] ────────────────────────────────

export async function patchConnector(a: ConnectorActor, id: string, patch: ConnectorPatch, check?: CheckOptions): Promise<WriteOutcome> {
  if (id !== LEGACY_CONNECTOR_ID && !isConnectorUuid(id)) return { ok: false, status: 404, body: { error: "not_found" } };
  const unsafe = await urlRefusal(patch.url, check);
  if (unsafe) return unsafe;
  const secret = patch.rotateSecret ? generateConnectorSecret() : null;
  let converted: { id: string; phoneNumberId: string | null } | null = null;
  let targetId = id;
  const changed: string[] = [];
  const out = await run(async () => {
    await db.transaction(async (tx) => {
      const account = await lockAccount(tx, a.userId);
      if (!account) refuse(404, { error: "not_found" });
      if (id === LEGACY_CONNECTOR_ID) {
        const legacy = await pendingLegacy(tx, a.userId, await rowCount(tx, a.userId));
        if (!legacy) refuse(404, { error: "not_found" });
        if (!patch.acknowledgeLegacyConversion) unacknowledged(legacy!.numberE164);
        targetId = await insertLegacy(tx, a.userId, legacy!.row);
        converted = { id: targetId, phoneNumberId: legacy!.row.phoneNumberId };
      }
      const [row] = await tx
        .select({ id: connectors.id, voiceConfig: connectors.voiceConfig })
        .from(connectors)
        .where(and(eq(connectors.id, targetId), eq(connectors.userId, a.userId)))
        .limit(1);
      if (!row) refuse(404, { error: "not_found" });
      const set: Partial<typeof connectors.$inferInsert> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.url !== undefined) set.url = patch.url;
      if (patch.mode !== undefined) set.mode = patch.mode;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      if (patch.voiceConfig !== undefined) set.voiceConfig = voiceToStore(row!.voiceConfig, patch.voiceConfig, a.sessionIsAdmin);
      if (secret) set.secret = sealForStorage(secret);
      changed.push(...Object.keys(set).filter((k) => k !== "secret"), ...(secret ? ["secretRotated"] : []));
      if (!Object.keys(set).length) return;
      await tx.update(connectors).set({ ...set, updatedAt: new Date() }).where(eq(connectors.id, row!.id));
    });
    return { ok: true, status: 200, body: {} };
  });
  if (!out.ok) return out;
  const c = converted as { id: string; phoneNumberId: string | null } | null;
  if (c) await logConverted(a, c.id, c.phoneNumberId, "patch_legacy");
  await logEvent({
    source: source(a),
    event: "connector_updated",
    message: "Connecteur modifié",
    userId: a.userId,
    // Field NAMES only: never a value (the url, the secret).
    metadata: { connectorId: targetId, fields: changed, ...(patch.url !== undefined ? { host: safeHost(patch.url) } : {}) },
  });
  const { page, connector } = await pageAnd(a.userId, targetId);
  return {
    ok: true,
    status: 200,
    body: { connector, ...(secret ? { generatedSecret: secret } : {}), ...(c ? { legacyConvertedId: c.id } : {}), page },
  };
}

// ── POST /api/dashboard/connectors/[id]/test ────────────────────────────

const LANGUAGES = ["fr", "he", "en"];

/**
 * One mock question to the connector's agent (lib/tools/client-agent-test.ts,
 * the same request as the worker). Writes last_test_at / last_test_ok on the
 * row. The derived legacy card ("legacy") is tested READ-ONLY (nothing
 * written, no conversion): its url / secret from tools_config.
 * The connector's mode doesn't change the test request (one contract shape).
 */
export async function testConnector(a: ConnectorActor, id: string, language: string | undefined): Promise<WriteOutcome> {
  if (id !== LEGACY_CONNECTOR_ID && !isConnectorUuid(id)) return { ok: false, status: 404, body: { error: "not_found" } };
  const [cfg] = await db
    .select({ toolsConfig: agentConfigs.toolsConfig, primaryLanguage: agentConfigs.primaryLanguage })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, a.userId))
    .limit(1);
  const lang =
    language && LANGUAGES.includes(language) ? language : LANGUAGES.includes(cfg?.primaryLanguage ?? "") ? cfg!.primaryLanguage : "fr";
  let url: string;
  let stored: string | null;
  if (id === LEGACY_CONNECTOR_ID) {
    const [{ n }] = await db.select({ n: count() }).from(connectors).where(eq(connectors.userId, a.userId));
    const parsed = Number(n) === 0 && cfg ? parseTools(cfg.toolsConfig) : null;
    const ca = parsed?.ok ? parsed.value.clientAgent : null;
    if (!ca || !ca.enabled || !ca.url.trim()) return { ok: false, status: 404, body: { error: "not_found" } };
    url = ca.url;
    stored = ca.secret;
  } else {
    const [row] = await db
      .select({ url: connectors.url, secret: connectors.secret })
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.userId, a.userId)))
      .limit(1);
    if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
    url = row.url;
    stored = row.secret;
  }
  // E1: the stored secret opened; unreadable = absent (reported).
  const result: ClientAgentTestResult = await runClientAgentTest({ url, secret: openStoredSecret("client_agent", stored), language: lang });
  let lastTestAt: string | null = null;
  if (id !== LEGACY_CONNECTOR_ID) {
    const at = new Date();
    await db
      .update(connectors)
      .set({ lastTestAt: at, lastTestOk: result.ok })
      .where(and(eq(connectors.id, id), eq(connectors.userId, a.userId)));
    lastTestAt = at.toISOString();
  }
  await logEvent({
    source: source(a),
    event: "connector_tested",
    message: result.ok ? `Test connecteur OK (${result.ms} ms)` : `Test connecteur échoué (${result.reason})`,
    userId: a.userId,
    metadata: { connectorId: id, ...(result.ok ? { ok: true, ms: result.ms } : { ok: false, reason: result.reason }) },
  });
  return { ok: true, status: 200, body: { ...result, lastTestAt } };
}
