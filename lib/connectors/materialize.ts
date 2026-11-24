// The legacy materialization (B4, VP rule): the account's FIRST connector is
// derived from the account-level tools_config.clientAgent and is WRITTEN as a
// real row on the account's first connector write (a POST of a new connector,
// or a PATCH on id "legacy"), in the SAME transaction as that write.
// Otherwise creating a second connector would silently drop the legacy agent:
// once rows exist, routing is per number (B2) and the legacy card is gone.
// Pure: decides WHETHER and WHAT to write; lib/connectors/write.ts writes it.
//   - only when the account has ZERO rows and an enabled legacy agent with a
//     url (the exact condition of the derived card, lib/connectors/legacy.ts);
//   - its url / mode / secret (the stored value copied AS IS, sealed or not:
//     nothing is re-sealed or opened), voice = null (the account voice),
//     name "" (the FE shows the localized default), enabled, on the account's
//     main (oldest) number, the one the derived card shows (null if none).
// tools_config.clientAgent itself is never modified.

import { parseTools } from "../tools/store";
import type { ConnectorMode } from "./types";

export type MaterializeInput = {
  connectorRowCount: number;
  /** agent_configs.tools_config as stored (NULL = never written). */
  toolsConfig: unknown;
  /** The account's main (oldest) number, or null. */
  mainNumber: { id: string; phoneNumber: string } | null;
};

export type LegacyRow = {
  name: string;
  url: string;
  mode: ConnectorMode;
  secret: string | null;
  voiceConfig: null;
  enabled: true;
  phoneNumberId: string | null;
};

export function legacyMaterialization(input: MaterializeInput): LegacyRow | null {
  if (input.connectorRowCount > 0) return null;
  const parsed = parseTools(input.toolsConfig);
  if (!parsed.ok) return null;
  const ca = parsed.value.clientAgent;
  if (!ca.enabled || !ca.url.trim()) return null;
  return {
    name: "",
    url: ca.url,
    mode: ca.mode,
    secret: ca.secret,
    voiceConfig: null,
    enabled: true,
    phoneNumberId: input.mainNumber?.id ?? null,
  };
}

/** What the GET exposes so the FE shows the conversion notice once, before saving. */
export type LegacyConversion = { willConvert: boolean; numberE164: string | null };

export function legacyConversionView(input: MaterializeInput): LegacyConversion {
  const row = legacyMaterialization(input);
  return { willConvert: row !== null, numberE164: row ? (input.mainNumber?.phoneNumber ?? null) : null };
}
