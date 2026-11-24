// Number → connector routing (B2): the DB reads + the FAIL-OPEN wrapper the
// inbound call path awaits. SERVER-ONLY. The decision itself is pure
// (lib/connectors/route.ts).
//
// FAIL-OPEN: any error in the lookup or on the matched row (a DB error, a bad
// row) → kind "reception" (NO clientAgent: Tamara answers alone) + ONE admin
// alert per account per day (key connector_route_failed:<accountId>). This
// never throws nor rejects: the call is never failed by a connector.
// CLIENT_AGENT switch off for the account → "legacy" with NO query at all.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectors, phoneNumbers } from "@/lib/db/schema";
import { normalizeE164 } from "@/lib/phone-utils";
import { parseTools } from "@/lib/tools/store";

import { fireSafely } from "@/lib/agent/fire-safely";
import { connectorServing, routeForCall, type ConnectorRouteRow, type ConnectorServing } from "./route";

const DAY_MS = 24 * 60 * 60 * 1000;

export const connectorRouteFailedAlertKey = (accountId: string) => `connector_route_failed:${accountId}`;

/** The same key as the account-level rule (#437): one alert per account per day. */
export const connectorNoSecretAlertKey = (accountId: string) => `client_agent_no_secret:${accountId}`;

export type ResolvedCallRoute =
  | { kind: "legacy" }
  | { kind: "reception"; failed?: true; accountAgentIgnored?: true }
  | { kind: "connector"; connectorId: string; serving: ConnectorServing };

/** The reads, injected so tests can make each one fail. Unset = the real ones. */
export interface ConnectorRouteDeps {
  loadRows: (accountId: string) => Promise<ConnectorRouteRow[]>;
  dialedPhoneRowId: (accountId: string, phone: string) => Promise<string | null>;
}

/** Only the columns of CONNECTOR_ROUTE_COLUMNS: never the name, the test results nor the dates. */
async function loadRows(accountId: string): Promise<ConnectorRouteRow[]> {
  return db
    .select({
      id: connectors.id,
      url: connectors.url,
      mode: connectors.mode,
      secret: connectors.secret,
      voiceConfig: connectors.voiceConfig,
      enabled: connectors.enabled,
      phoneNumberId: connectors.phoneNumberId,
    })
    .from(connectors)
    .where(eq(connectors.userId, accountId));
}

/**
 * The account's phone_numbers row for the dialed number: the plain E.164
 * first, else the `whatsapp:`-prefixed row (the same two matches as
 * resolveTenantByPhone, restricted to the account).
 */
async function dialedPhoneRowId(accountId: string, phone: string): Promise<string | null> {
  const n = normalizeE164(phone);
  const rows = await db
    .select({ id: phoneNumbers.id, phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.userId, accountId), inArray(phoneNumbers.phoneNumber, [n, `whatsapp:${n}`])));
  return (rows.find((r) => r.phoneNumber === n) ?? rows[0])?.id ?? null;
}

export const LIVE_CONNECTOR_ROUTE_DEPS: ConnectorRouteDeps = { loadRows, dialedPhoneRowId };

type RouteAlert = (args: {
  key: string;
  subject: string;
  body: string;
  dedupMs: number;
  severity?: "critical" | "warning";
}) => Promise<unknown>;

/** The account-level client agent switch as stored (observation only). */
function accountAgentOn(toolsConfig: unknown): { enabled: boolean } | null {
  const t = parseTools(toolsConfig);
  return t.ok ? { enabled: t.value.clientAgent.enabled } : null;
}

/** Never throws, never rejects. See the top of this file. */
export async function resolveCallRouteSafely(args: {
  accountId: string;
  /** The dialed number, null when the call is resolved by userId (web / call_me). */
  phone: string | null;
  /** The CLIENT_AGENT switch for this account. */
  switchOn: boolean;
  /** agent_configs.tools_config as stored. */
  toolsConfig: unknown;
  /**
   * The reads: unset = the real ones; null = routing BYPASSED ("legacy", no
   * lookup: the pre-B2 code path, used by the zero-rows invariant tests).
   */
  deps?: ConnectorRouteDeps | null;
  alert: RouteAlert;
}): Promise<ResolvedCallRoute> {
  if (!args.switchOn || args.deps === null) return { kind: "legacy" };
  const deps = args.deps ?? LIVE_CONNECTOR_ROUTE_DEPS;
  try {
    const rows = await deps.loadRows(args.accountId);
    if (rows.length === 0) return { kind: "legacy" };
    const dialed = args.phone ? await deps.dialedPhoneRowId(args.accountId, args.phone) : null;
    const route = routeForCall({ connectorRows: rows, dialedPhoneRowId: dialed, accountClientAgent: accountAgentOn(args.toolsConfig) });
    if (route.kind === "connector") {
      const row = rows.find((r) => r.id === route.connectorId)!;
      return { kind: "connector", connectorId: row.id, serving: connectorServing(row) };
    }
    return route.accountAgentIgnored ? { kind: "reception", accountAgentIgnored: true } : { kind: "reception" };
  } catch {
    // Fail-open: Tamara answers alone. The alert carries the account id only.
    void fireSafely(() =>
      args.alert({
        key: connectorRouteFailedAlertKey(args.accountId),
        subject: "Connector routing failed",
        body: `The connector lookup failed for account ${args.accountId}. Its calls are answered by Tamara alone (no client agent) until it is fixed.`,
        dedupMs: DAY_MS,
        severity: "warning",
      }),
    );
    return { kind: "reception", failed: true };
  }
}
