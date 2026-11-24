// Number → connector routing on the inbound call path (B2). PURE.
//
// The rule (VP, binding):
//   - ZERO connector rows for the account → "legacy": today's behaviour
//     exactly (the account-level tools_config.clientAgent, as served today).
//   - >= 1 connector row:
//       the dialed number BELONGS to an ENABLED connector → "connector": that
//         connector's agent (url / mode / secret) and its voice if set;
//       the connector on that number is OFF, or the dialed number is not a
//         connector's (another number of the account, or no number at all:
//         the web LiveTest / call_me) → "reception": Tamara alone, NO
//         clientAgent, EVEN IF the account-level setting is enabled (once the
//         account has rows, the account-level setting no longer applies).
// The caller (lib/connectors/route-load.ts) also gates everything on the
// CLIENT_AGENT site switch: switch off for the account = "legacy", no lookup.
//
// Vox exclusivity: a number is never both a connector number and a tamaravox
// number (refused at creation by B4 / B5, lib/connectors/number-exclusivity.ts).
// Even if it were, the worker gives a tamaravox config (voxAgentId) precedence
// over the served clientAgent (worker src/brain-mode.ts), so nothing here has
// to arbitrate it.

import { CLIENT_AGENT_MODES, type ClientAgentMode, type ClientAgentStored } from "../tools/contract";
import { parseVoice, type Voice } from "../voice/contract";

/** The connector columns the call path READS. Every other column is never read nor served. */
export const CONNECTOR_ROUTE_COLUMNS = ["id", "url", "mode", "secret", "voiceConfig", "enabled", "phoneNumberId"] as const;

export type ConnectorRouteRow = {
  id: string;
  url: string;
  mode: string;
  /** As stored: sealed (E1) or plain; opened only to serve. */
  secret: string | null;
  voiceConfig: unknown;
  enabled: boolean;
  phoneNumberId: string | null;
};

export type CallRouteKind = "legacy" | "connector" | "reception";

export type CallRoute = {
  kind: CallRouteKind;
  /** Only for kind "connector". */
  connectorId?: string;
  /** "reception" while the account-level client agent is switched on (it no longer applies). */
  accountAgentIgnored?: true;
};

/** Which route a call takes. Pure; see the rule at the top of this file. */
export function routeForCall(args: {
  connectorRows: ReadonlyArray<Pick<ConnectorRouteRow, "id" | "enabled" | "phoneNumberId">>;
  /** The phone_numbers row of the dialed number (null: no number, e.g. web). */
  dialedPhoneRowId: string | null;
  /** The account-level tools_config.clientAgent (only its switch matters here). */
  accountClientAgent: Pick<ClientAgentStored, "enabled"> | null;
}): CallRoute {
  const { connectorRows, dialedPhoneRowId, accountClientAgent } = args;
  if (connectorRows.length === 0) return { kind: "legacy" };
  const own = dialedPhoneRowId ? connectorRows.find((r) => r.phoneNumberId === dialedPhoneRowId) : undefined;
  if (own && own.enabled) return { kind: "connector", connectorId: own.id };
  return accountClientAgent?.enabled === true ? { kind: "reception", accountAgentIgnored: true } : { kind: "reception" };
}

/** What a connector row serves: its agent (as the Tools contract stores it) and its voice. */
export type ConnectorServing = { clientAgent: ClientAgentStored; voice: Voice | null };

/**
 * The matched row → what it serves. THROWS on a row it can't trust (bad mode,
 * url or secret type, an unparseable voice_config): the caller then fails
 * open (no clientAgent, one admin alert). The error never carries a value.
 */
export function connectorServing(row: ConnectorRouteRow): ConnectorServing {
  if (!(CLIENT_AGENT_MODES as readonly string[]).includes(row.mode)) throw new Error("connector row: bad mode");
  if (typeof row.url !== "string") throw new Error("connector row: bad url");
  if (row.secret !== null && typeof row.secret !== "string") throw new Error("connector row: bad secret");
  let voice: Voice | null = null;
  if (row.voiceConfig !== null && row.voiceConfig !== undefined) {
    const v = parseVoice(row.voiceConfig);
    if (!v.ok) throw new Error("connector row: bad voice_config");
    voice = v.value;
  }
  return {
    clientAgent: { enabled: true, url: row.url, mode: row.mode as ClientAgentMode, secret: row.secret },
    voice,
  };
}

/** The voice as served for a connector: the model filled like servedInboundVoice. */
export function servedConnectorVoice(v: Voice, defaultModel: string): Voice {
  return { ...v, advanced: { ...v.advanced, model: v.advanced.model ?? defaultModel } };
}
