// The connectors page (B1): the pure assembly + the server loader behind
// GET /api/dashboard/connectors. Read only: nothing here writes.
// The secret is NEVER selected: the query picks `secret IS NOT NULL` as
// secretSet (explicit field picks, the admin-routes-no-secrets rule).

import { and, eq, inArray, isNotNull, max, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, calls, connectors, phoneNumbers, users } from "@/lib/db/schema";
import { oldestTenantNumberWithLabel } from "@/lib/phone/oldest-number";
import { currencyForLocale } from "@/lib/hyp";
import { activeTrialProducts } from "@/lib/product-trials";
import { ACCOUNT_PRODUCTS_PICK, getCatalogueRow, loadProductTrials } from "@/lib/products";

import { connectProductActive, withDeletable, type ConnectorCard } from "./deletable";
import { canAddConnector, connectorsInTrial, maxConnectors, type ConnectorAccount } from "./entitlement";
import { connectorRowView, legacyConnectorView, type ConnectorRowPick } from "./legacy";
import { defaultConnectorLimits, type ConnectorLimits } from "./limits";
import {
  DEFAULT_CONNECTOR_EXTRA_MONTHLY,
  defaultConnectorExtraMonthly,
  nextConnectorPrice,
  type ConnectorExtraMonthly,
  type ConnectorPriceCurrency,
} from "./price";
import type { ConnectorsPageView } from "./types";

/**
 * Pure: the page from the account's connector cards (rows oldest first, else
 * the derived card). C1b: `deletable` per card (lib/connectors/deletable.ts,
 * `productActive` = connectProductActive) and canAdd.price (the next
 * connector's extra price in `currency`, lib/connectors/price.ts).
 */
export function connectorsPageView(args: {
  connectors: ConnectorCard[];
  account: ConnectorAccount;
  limits: ConnectorLimits;
  productActive: boolean;
  currency: ConnectorPriceCurrency;
  prices?: ConnectorExtraMonthly;
  env?: Record<string, string | undefined>;
}): ConnectorsPageView {
  const used = args.connectors.length;
  const inTrial = connectorsInTrial(args.account);
  const canAdd = canAddConnector(args.account, used, args.limits, args.env ?? process.env);
  const price = nextConnectorPrice({ inTrial, used, currency: args.currency, prices: args.prices ?? DEFAULT_CONNECTOR_EXTRA_MONTHLY });
  return {
    connectors: withDeletable(args.connectors, args.productActive),
    limits: { max: maxConnectors(args.account, args.limits), used, inTrial },
    canAdd: canAdd.ok ? { ok: true, price } : { ok: false, reason: canAdd.reason, price },
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
    .select({ ...ACCOUNT_PRODUCTS_PICK, role: users.role, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) return null;
  const [rows, row, trials] = await Promise.all([loadConnectorRows(userId), getCatalogueRow(), loadProductTrials(userId)]);
  const limits = row.connectorLimits ?? defaultConnectorLimits();
  const prices = row.connectorExtraMonthly ?? defaultConnectorExtraMonthly();
  const productActive = connectProductActive({ ...account, activeTrials: activeTrialProducts(trials, new Date()) });
  let views: ConnectorCard[];
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
  return connectorsPageView({
    connectors: views,
    account,
    limits,
    productActive,
    // The account's billing currency, as billing-stats / orders resolve it (he → ILS, else EUR).
    currency: currencyForLocale(account.locale),
    prices,
    env,
  });
}
