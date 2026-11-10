// Storing `persona` with the agent (P3, write-alongside). Pure.
//
// - agent_configs.persona_config / outbound_agents.persona_config hold the
//   Persona contract (NULL = never written: derived from the columns).
// - The calls' read source stays the legacy columns, so:
//     · a `personaConfig` write ALSO writes the legacy columns it maps to
//       (lib/persona/columns.ts) — what callers hear changes exactly as with
//       a legacy save;
//     · a legacy write ALSO refreshes the stored persona.
// - "Automatic" never destroys the customer's sentence: the stored persona
//   keeps greeting.mode and greeting.text independently. mode=auto writes ''
//   to the legacy greeting column but keeps the text in the store.
// - A request carrying `personaConfig` AND legacy persona fields is refused:
//   400 persona_config_conflict.

import {
  personaFromInbound,
  personaFromOutbound,
  type InboundPersonaColumns,
  type OutboundPersonaColumns,
} from "@/lib/persona/adapters";
import { personaToInboundColumns, personaToOutboundColumns } from "@/lib/persona/columns";
import {
  LANGUAGES_TENANT_EDITABLE,
  mergePersona,
  OUTBOUND_DISCLOSURE_TENANT_EDITABLE,
  parsePersona,
  type Persona,
} from "@/lib/persona/contract";

export const LEGACY_INBOUND_PERSONA_FIELDS = [
  "agentName",
  "primaryLanguage",
  "greetingInstructions",
  "aiDisclosureEnabled",
  "aiDisclosureText",
] as const;
export const LEGACY_OUTBOUND_PERSONA_FIELDS = ["agentName", "language", "greeting"] as const;

export type PersonaWriteError = { status: 400 | 403; body: { error: string; fields?: string[] } };

export function currentInboundPersona(stored: unknown, row: InboundPersonaColumns): Persona {
  const s = parsePersona(stored);
  return s.ok ? s.value : personaFromInbound(row);
}

export function currentOutboundPersona(stored: unknown, row: OutboundPersonaColumns): Persona {
  const s = parsePersona(stored);
  return s.ok ? s.value : personaFromOutbound(row);
}

function plan(
  body: Record<string, unknown>,
  legacy: readonly string[],
  current: Persona,
  isAdmin: boolean,
): { error: PersonaWriteError } | { persona: Persona } | null {
  if (!("personaConfig" in body)) return null;
  const conflict = legacy.filter((f) => f in body);
  if (conflict.length) return { error: { status: 400, body: { error: "persona_config_conflict", fields: conflict } } };
  const merged = mergePersona(current, body.personaConfig);
  if (!merged.ok) return { error: { status: 400, body: { error: "invalid_persona_config", fields: [merged.error] } } };
  // P4 gate: SETTING a non-empty spoken-languages list is admin-only for now
  // (a tenant saving other fields under an admin-set list is fine).
  const languagesChanged = JSON.stringify(merged.value.languages) !== JSON.stringify(current.languages);
  if (!isAdmin && !LANGUAGES_TENANT_EDITABLE && languagesChanged && merged.value.languages.length > 0) {
    return { error: { status: 403, body: { error: "admin_only", fields: ["languages"] } } };
  }
  return { persona: merged.value };
}

/** Inbound `personaConfig` patch → legacy columns + personaConfig; null if absent. */
export function inboundPersonaUpdates(
  body: Record<string, unknown>,
  row: InboundPersonaColumns & { personaConfig: unknown },
  isAdmin: boolean,
): { error: PersonaWriteError } | { updates: Record<string, unknown>; persona: Persona } | null {
  const p = plan(body, LEGACY_INBOUND_PERSONA_FIELDS, currentInboundPersona(row.personaConfig, row), isAdmin);
  if (!p || "error" in p) return p;
  return { updates: { ...personaToInboundColumns(p.persona), personaConfig: p.persona }, persona: p.persona };
}

/** Outbound `personaConfig` patch → legacy columns + personaConfig; null if absent. */
export function outboundPersonaUpdates(
  body: Record<string, unknown>,
  row: OutboundPersonaColumns & { personaConfig: unknown },
  isAdmin: boolean,
): { error: PersonaWriteError } | { updates: Record<string, unknown>; persona: Persona } | null {
  const current = currentOutboundPersona(row.personaConfig, row);
  const p = plan(body, LEGACY_OUTBOUND_PERSONA_FIELDS, current, isAdmin);
  if (!p || "error" in p) return p;
  // P5 gate: TURNING ON (or changing the line of) the outbound AI disclosure
  // is admin-only for now; saving other fields under an admin-set one is fine.
  const disclosureChanged = JSON.stringify(p.persona.aiDisclosure) !== JSON.stringify(current.aiDisclosure);
  if (!isAdmin && !OUTBOUND_DISCLOSURE_TENANT_EDITABLE && disclosureChanged && p.persona.aiDisclosure.enabled) {
    return { error: { status: 403, body: { error: "admin_only", fields: ["aiDisclosure.enabled"] } } };
  }
  const cols = personaToOutboundColumns(p.persona);
  // Same rule as normalizeAgentFields: `name` (list/campaign label) always
  // follows `agentName`, and an empty name falls back to "Sarah".
  const agentName = cols.agentName.trim().slice(0, 120) || "Sarah";
  return {
    updates: { ...cols, agentName, name: agentName, personaConfig: p.persona },
    persona: p.persona,
  };
}

/**
 * After a legacy write: re-derive from the merged row, keeping what the
 * columns can't hold — the sentence of an "auto" greeting, `languages`, and
 * (outbound) the AI disclosure.
 */
function keepUnstored(derived: Persona, stored: unknown, outbound: boolean): Persona {
  const s = parsePersona(stored);
  if (!s.ok) return derived;
  return {
    ...derived,
    greeting: derived.greeting.mode === "auto" ? { mode: "auto", text: s.value.greeting.text } : derived.greeting,
    languages: s.value.languages.filter((l) => l !== derived.primaryLanguage),
    ...(outbound ? { aiDisclosure: s.value.aiDisclosure } : {}),
  };
}

export function inboundPersonaAfterLegacy(
  row: InboundPersonaColumns & { personaConfig: unknown },
  updates: Partial<InboundPersonaColumns>,
): Persona {
  return keepUnstored(personaFromInbound({ ...row, ...updates }), row.personaConfig, false);
}

export function outboundPersonaAfterLegacy(
  row: OutboundPersonaColumns & { personaConfig: unknown },
  updates: Partial<OutboundPersonaColumns>,
): Persona {
  return keepUnstored(personaFromOutbound({ ...row, ...updates }), row.personaConfig, true);
}
