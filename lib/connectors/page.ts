// The connectors page (B1): the pure assembly + the server loader behind
// GET /api/dashboard/connectors. Read only: nothing here writes.
// The secret is NEVER selected: the query picks `secret IS NOT NULL` as
// secretSet (explicit field picks, the admin-routes-no-secrets rule).

import { and, eq, inArray, isNotNull, max, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, calls, connectors, phoneNumbers, users } from "@/lib/db/schema";
import { oldestTenantNumberWithLabel } from "@/lib/phone/oldest-number";
import { getConnectorLimits } from "@/lib/products";

import { canAddConnector, connectorsInTrial, maxConnectors, type ConnectorAccount } from "./entitlement";
import { connectorRowView, legacyConnectorView, type ConnectorRowPick } from "./legacy";
import type { ConnectorLimits } from "./limits";
import type { ConnectorsPageView, ConnectorView } from "./types";

/** Pure: the page from the account's connector views (rows, else the derived card). */
export function connectorsPageView(args: {
  connectors: ConnectorView[];
  account: ConnectorAccount;
  limits: ConnectorLimits;
  env?: Record<string, string | undefined>;
}): ConnectorsPageView {
  const used = args.connectors.length;
  const canAdd = canAddConnector(args.account, used, args.limits, args.env ?? process.env);
  return {
    connectors: args.connectors,
    limits: { max: maxConnectors(args.account, args.limits), used, inTrial: connectorsInTrial(args.account) },
    canAdd: canAdd.ok ? { ok: true } : { ok: false, reason: canAdd.reason },
  };
}

/** The account's connector rows, picked field by field (never `secret`). */
export async function loadConnectorRows(userId: string): Promise<ConnectorRowPick[]> {
  return db
    .select({
      id: connectors.id,
      name: connectors.name,
      mode: connectors.mode,
      enabled: connectors.enabled,
      secretSet: sql<boolean>`(${connectors.secret} IS NOT NULL)`,
      lastTestAt: connectors.lastTestAt,
      lastTestOk: connectors.lastTestOk,
      phoneNumber: phoneNumbers.phoneNumber,
      phoneLabel: phoneNumbers.label,
    })
    .from(connectors)
    .leftJoin(phoneNumbers, and(eq(phoneNumbers.id, connectors.phoneNumberId), eq(phoneNumbers.userId, connectors.userId)))
    .where(eq(connectors.userId, userId))
    .orderBy(connectors.createdAt, connectors.id);
}

/** Last call per connector, from calls.connector_id (empty until B3 writes it). */
export async function loadLastCallAt(userId: string, ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ connectorId: calls.connectorId, at: max(calls.createdAt) })
    .from(calls)
    .where(and(eq(calls.userId, userId), isNotNull(calls.connectorId), inArray(calls.connectorId, ids)))
    .groupBy(calls.connectorId);
  const out = new Map<string, Date>();
  for (const r of rows) if (r.connectorId && r.at) out.set(r.connectorId, new Date(r.at));
  return out;
}

/** The whole page for an account, or null when the account does not exist. */
export async function loadConnectorsPage(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ConnectorsPageView | null> {
  const [account] = await db
    .select({ subscriptionStatus: users.subscriptionStatus, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) return null;
  const [rows, limits] = await Promise.all([loadConnectorRows(userId), getConnectorLimits()]);
  let views: ConnectorView[];
  if (rows.length) {
    const last = await loadLastCallAt(userId, rows.map((r) => r.id));
    views = rows.map((r) => connectorRowView(r, last.get(r.id) ?? null));
  } else {
    const [[cfg], mainNumber] = await Promise.all([
      db.select({ toolsConfig: agentConfigs.toolsConfig }).from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1),
      oldestTenantNumberWithLabel(userId),
    ]);
    const legacy = legacyConnectorView({ connectorRowCount: 0, toolsConfig: cfg?.toolsConfig ?? null, mainNumber });
    views = legacy ? [legacy] : [];
  }
  return connectorsPageView({ connectors: views, account, limits, env });
}
