// Which connector a call belongs to, at /api/calls/end (B3) — SERVER-ONLY.
//
// The ONLY source is the signed `connectorRoute` token session-config served
// for that call (lib/connectors/route-token.ts), echoed back by the worker.
// calls/end NEVER re-evaluates the routing rule (no routeForCall, no
// resolveCallRouteSafely here: a connector toggled / edited / deleted
// mid-call would misattribute the call; guarded by a source test).
//
//   token ABSENT (undefined / null: an old worker, or not a connector call)
//     → {} : today's row, byte for byte, no alert;
//   token VALID for this account
//     → product 'connect' + connector_id = its id if a connectors row with
//       that id still EXISTS for the account. Existence only, no state filter:
//       a disabled connector, and (VP 24/11) a SOFT-deleted one (a later PR
//       adds connectors.deleted_at; the row is kept) still get the id. A row
//       truly gone (hard delete, FK miss) → connector_id NULL, 'connect' kept:
//       the call WAS a connector call;
//   token INVALID (tampered, another account, expired, no key, not a string)
//     or ANY error (a throwing verifier, a DB error)
//     → {} : today's row + ONE admin alert per account per day
//       (connector_attribution_failed:<accountId>).
// Never throws, never rejects: calls/end drives the recap WhatsApp / email.

import { and, eq } from "drizzle-orm";

import { fireSafely } from "@/lib/agent/fire-safely";
import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { connectors } from "@/lib/db/schema";

import { connectorRouteKey, verifyConnectorRoute, type RouteTokenCheck } from "./route-token";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const connectorAttributionFailedAlertKey = (accountId: string) => `connector_attribution_failed:${accountId}`;

/** The columns calls/end merges into the inserted row; {} = today's row. */
export type CallAttribution = { product?: "connect"; connectorId?: string | null };

type Alert = (args: { key: string; subject: string; body: string; dedupMs: number; severity?: "critical" | "warning" }) => Promise<unknown>;

export interface CallAttributionDeps {
  /** true = attribution BYPASSED (the pre-B3 code path; tests only). */
  bypassed: boolean;
  verify: (token: unknown, accountId: string) => RouteTokenCheck;
  connectorExists: (accountId: string, connectorId: string) => Promise<boolean>;
  alert: Alert;
}

async function connectorExists(accountId: string, connectorId: string): Promise<boolean> {
  const rows = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, accountId)))
    .limit(1);
  return rows.length > 0;
}

/** Mutable so the DB suites inject failures; production uses these. */
export const callAttributionDeps: CallAttributionDeps = {
  bypassed: false,
  verify: (token, accountId) => verifyConnectorRoute(token, { accountId, key: connectorRouteKey() }),
  connectorExists,
  alert: alertAdmins,
};

/** Never throws, never rejects. See the top of this file. */
export async function attributionFromToken(
  token: unknown,
  accountId: string,
  deps: CallAttributionDeps = callAttributionDeps,
): Promise<CallAttribution> {
  if (deps.bypassed || token === undefined || token === null) return {};
  let reason = "error";
  try {
    const check = deps.verify(token, accountId);
    if (check.ok) {
      // A signed id that is not a uuid can't be a connectors row: NULL, 'connect' kept.
      const exists = UUID.test(check.connectorId) ? await deps.connectorExists(accountId, check.connectorId) : false;
      return { product: "connect", connectorId: exists ? check.connectorId : null };
    }
    reason = check.reason;
  } catch {
    reason = "error";
  }
  // Fail-open: today's row. The alert carries the account id and a reason code only.
  void fireSafely(() =>
    deps.alert({
      key: connectorAttributionFailedAlertKey(accountId),
      subject: "Connector call attribution failed",
      body: `A call of account ${accountId} came back with a connector route that could not be used (${reason}). It is recorded as a normal call (no connector, product as before).`,
      dedupMs: DAY_MS,
      severity: "warning",
    }),
  );
  return {};
}
