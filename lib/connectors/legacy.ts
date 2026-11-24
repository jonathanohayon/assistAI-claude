// The legacy connector card (B1). Pure.
//
// ZERO connector rows = today's behaviour exactly: the account-level
// agent_configs.tools_config.clientAgent. When that setting is enabled with
// a url, the page shows it as ONE derived card (id "legacy", derived: true)
// riding on the account's main number (its oldest, lib/phone/oldest-number.ts).
// Nothing is written here: the card's FIRST edit / save turns it into a row
// (B4). With >= 1 connector row there is no derived card: the rows are the
// truth.
// The card's display name is the FE's (localized) when `name` is "".
// TODO(B7): "unreachable" from the last test / call outcome.

import { parseTools } from "../tools/store";
import type { ConnectorMode, ConnectorView } from "./types";

export const LEGACY_CONNECTOR_ID = "legacy" as const;

export type LegacyInput = {
  /** How many connector rows the account has. */
  connectorRowCount: number;
  /** agent_configs.tools_config as stored (NULL = never written). */
  toolsConfig: unknown;
  /** The account's main (oldest) number, or null when it has none. */
  mainNumber: { phoneNumber: string; label: string } | null;
};

export function legacyConnectorView(input: LegacyInput): ConnectorView | null {
  if (input.connectorRowCount > 0) return null;
  const parsed = parseTools(input.toolsConfig);
  if (!parsed.ok) return null;
  const ca = parsed.value.clientAgent;
  if (!ca.enabled || !ca.url.trim()) return null;
  return {
    id: LEGACY_CONNECTOR_ID,
    name: "",
    numberE164: input.mainNumber?.phoneNumber ?? null,
    ...(input.mainNumber?.label ? { numberLabel: input.mainNumber.label } : {}),
    mode: ca.mode,
    enabled: true,
    derived: true,
    state: "online",
    lastCallAt: null,
    lastTestAt: null,
    lastTestOk: null,
    secretSet: Boolean(ca.secret),
  };
}

/** A connector row as the read path picks it: NEVER the secret itself. */
export type ConnectorRowPick = {
  id: string;
  name: string;
  mode: string;
  enabled: boolean;
  secretSet: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  phoneNumber: string | null;
  phoneLabel: string | null;
};

export function connectorRowView(row: ConnectorRowPick, lastCallAt: Date | null): ConnectorView {
  return {
    id: row.id,
    name: row.name,
    numberE164: row.phoneNumber,
    ...(row.phoneLabel ? { numberLabel: row.phoneLabel } : {}),
    // The CHECK constraint holds mode to lead | voice.
    mode: row.mode as ConnectorMode,
    enabled: row.enabled,
    derived: false,
    // TODO(B7): "unreachable".
    state: row.enabled ? "online" : "off",
    lastCallAt: lastCallAt ? lastCallAt.toISOString() : null,
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestOk: row.lastTestOk,
    secretSet: row.secretSet,
  };
}
