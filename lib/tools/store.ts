// Storing `tools` with the agent (T3, write-alongside). Pure.
//
// - agent_configs.tools_config / outbound_agents.tools_config hold the Tools
//   contract (NULL = never written: derived).
// - The calls' read source stays today's settings: the CRM tile toggles
//   (booking / contacts / orders) and agent_configs.transfer_number. So:
//     · a `tools` write ALSO writes them (same transaction);
//     · reads take the SWITCHES from them, always — another path writing
//       them (tile toggles, admin config) can never drift from `tools`; the
//       stored value only adds what they can't hold (level-2 settings).
// - Transfer OFF: transfer_number := '' and the number is kept in
//   transfer_number_parked; ON restores it. A legacy number write clears it.
// - Outbound: stored only, no legacy field (no tools until T4).
// - No admin-only field: unknown keys are refused (400), so neither the plan
//   matrix nor technical tool names can be written through `tools`.

import type { TileToggles } from "@/lib/tile-toggles";
import { OUTBOUND_TOOLS, toolsFromTileToggles } from "@/lib/tools/adapters";
import type { PlanFeatures } from "@/lib/plan-features";
import {
  CAPABILITY_KEYS,
  effectiveCapabilities,
  OUTBOUND_CAPABILITIES,
  TOOLS_VERSION,
  TRANSFER_WHEN,
  type EffectiveCapabilities,
  type Tools,
} from "@/lib/tools/contract";

export const ORDERS_ASK_MAX = 1000;

type Parse<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const SHAPE: Record<keyof Omit<Tools, "version">, Record<string, (v: unknown) => string | null>> = {
  booking: {
    enabled: (v) => (typeof v === "boolean" ? null : "must be a boolean"),
    defaultDurationMinutes: (v) =>
      v === null || (Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 480) ? null : "null or an integer 5–480",
    minNoticeMinutes: (v) =>
      v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10080) ? null : "null or an integer 0–10080",
  },
  contacts: { enabled: (v) => (typeof v === "boolean" ? null : "must be a boolean") },
  transfer: {
    enabled: (v) => (typeof v === "boolean" ? null : "must be a boolean"),
    when: (v) => ((TRANSFER_WHEN as readonly unknown[]).includes(v) ? null : `one of ${TRANSFER_WHEN.join(", ")}`),
  },
  orders: {
    enabled: (v) => (typeof v === "boolean" ? null : "must be a boolean"),
    ask: (v) => (typeof v === "string" && v.length <= ORDERS_ASK_MAX ? null : `a string of at most ${ORDERS_ASK_MAX} characters`),
  },
};

/** A full Tools value, strict: every key present and valid, no unknown key. */
export function parseTools(v: unknown): Parse<Tools> {
  if (!isObj(v)) return { ok: false, errors: ["tools: must be an object"] };
  const errors: string[] = [];
  if (v.version !== TOOLS_VERSION) errors.push(`tools.version: must be ${TOOLS_VERSION}`);
  for (const k of Object.keys(v)) if (k !== "version" && !(k in SHAPE)) errors.push(`tools.${k}: unknown`);
  for (const [cap, fields] of Object.entries(SHAPE)) {
    const c = v[cap];
    if (!isObj(c)) {
      errors.push(`tools.${cap}: must be an object`);
      continue;
    }
    for (const k of Object.keys(c)) if (!(k in fields)) errors.push(`tools.${cap}.${k}: unknown`);
    for (const [f, check] of Object.entries(fields)) {
      const e = check(c[f]);
      if (e) errors.push(`tools.${cap}.${f}: ${e}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: v as unknown as Tools };
}

/** Partial patch: capability objects merge key by key. */
export function mergeTools(current: Tools, patch: unknown): Parse<Tools> {
  if (!isObj(patch)) return { ok: false, errors: ["tools: must be an object"] };
  const merged: Record<string, unknown> = { ...current, version: current.version };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "version") continue;
    const cur = (current as unknown as Record<string, unknown>)[k];
    merged[k] = isObj(cur) && isObj(v) ? { ...cur, ...v } : v;
  }
  return parseTools(merged);
}

// ── Receptionist: legacy settings ⇄ tools ──────────────────────────────

export interface ReceptionistToolSettings {
  toolsConfig: unknown;
  transferNumber: string;
  transferNumberParked: string | null;
}

/** The receptionist's tools: switches from today's settings + stored level-2 settings. */
export function currentReceptionistTools(row: ReceptionistToolSettings, toggles: TileToggles): Tools {
  const derived = toolsFromTileToggles(toggles);
  const stored = parseTools(row.toolsConfig);
  const transferOff = !row.transferNumber && !!row.transferNumberParked;
  if (!stored.ok) return { ...derived, transfer: { ...derived.transfer, enabled: !transferOff } };
  const s = stored.value;
  return {
    version: TOOLS_VERSION,
    booking: { ...s.booking, enabled: derived.booking.enabled },
    contacts: { enabled: derived.contacts.enabled },
    // A number served = ON; a parked number = OFF; neither = the stored switch.
    transfer: { ...s.transfer, enabled: row.transferNumber ? true : transferOff ? false : s.transfer.enabled },
    orders: { ...s.orders, enabled: derived.orders.enabled },
  };
}

/** The account's transfer number whatever the switch (call_me targets, the screen). */
export function accountTransferNumber(row: Pick<ReceptionistToolSettings, "transferNumber" | "transferNumberParked">): string {
  return row.transferNumber || row.transferNumberParked || "";
}

export type ReceptionistToolsWrite =
  | {
      ok: true;
      tools: Tools;
      toggles: TileToggles;
      columns: { toolsConfig: Tools; transferNumber: string; transferNumberParked: string | null };
    }
  | { ok: false; status: 400; error: "invalid_tools"; fields: string[] };

export function planReceptionistToolsWrite(
  row: ReceptionistToolSettings,
  toggles: TileToggles,
  patch: unknown,
): ReceptionistToolsWrite {
  const merged = mergeTools(currentReceptionistTools(row, toggles), patch);
  if (!merged.ok) return { ok: false, status: 400, error: "invalid_tools", fields: merged.errors };
  const t = merged.value;
  const number = accountTransferNumber(row);
  return {
    ok: true,
    tools: t,
    toggles: { calendar: t.booking.enabled, customers: t.contacts.enabled, orders: t.orders.enabled },
    columns: {
      toolsConfig: t,
      transferNumber: t.transfer.enabled ? number : "",
      transferNumberParked: t.transfer.enabled || !number ? null : number,
    },
  };
}

/**
 * A legacy transferNumber write (dashboard / admin config): the new number is
 * served, nothing stays parked (a non-empty number = transfer ON). Re-sending
 * the current served value changes nothing (an OFF switch stays OFF).
 */
export function columnsAfterLegacyTransferWrite(
  row: ReceptionistToolSettings,
  toggles: TileToggles,
  transferNumber: string,
): { transferNumber: string; transferNumberParked: string | null; toolsConfig: Tools } | null {
  if (transferNumber === row.transferNumber) return null;
  const next = { ...row, transferNumber, transferNumberParked: null };
  return { transferNumber, transferNumberParked: null, toolsConfig: currentReceptionistTools(next, toggles) };
}

// ── Outbound: stored only ──────────────────────────────────────────────

export function currentOutboundTools(stored: unknown): Tools {
  const s = parseTools(stored);
  return s.ok ? s.value : OUTBOUND_TOOLS;
}

export function planOutboundToolsWrite(stored: unknown, patch: unknown): Parse<Tools> {
  return mergeTools(currentOutboundTools(stored), patch);
}

/**
 * Server gate on an outbound tools write (T4): TURNING ON a capability
 * outbound calls can't use — the OUTBOUND_TOOLS switch is off for this
 * account, or it isn't an outbound capability (contacts, orders) — is
 * refused. Other fields, an unchanged re-send and turning one OFF pass.
 * Returns the refused paths ([] = allowed).
 */
export function outboundToolsRefused(current: Tools, next: Tools, enabled: boolean): string[] {
  const out: string[] = [];
  for (const k of CAPABILITY_KEYS) {
    const turnedOn = next[k].enabled && !current[k].enabled;
    if (turnedOn && (!enabled || !OUTBOUND_CAPABILITIES.includes(k))) out.push(`tools.${k}.enabled`);
  }
  return out;
}

// ── The ONE capabilities computation the call and the screen share ─────

export function receptionistCapabilities(
  row: ReceptionistToolSettings,
  toggles: TileToggles,
  googleConnected: boolean,
  plan: PlanFeatures,
): { tools: Tools; capabilities: EffectiveCapabilities } {
  const tools = currentReceptionistTools(row, toggles);
  return {
    tools,
    capabilities: effectiveCapabilities(
      { recipe: "receptionist", tools },
      { transferNumber: accountTransferNumber(row), googleConnected },
      plan,
    ),
  };
}

export function outboundCapabilities(
  stored: unknown,
  account: { googleConnected: boolean; transferNumber: string; outboundToolsEnabled: boolean },
  plan: PlanFeatures,
): { tools: Tools; capabilities: EffectiveCapabilities } {
  const tools = currentOutboundTools(stored);
  return {
    tools,
    capabilities: effectiveCapabilities({ recipe: "outbound", tools }, account, plan),
  };
}

/**
 * Drops the raw Tools store from a row returned by the older config APIs:
 * the screen reads /api/dashboard/tools (switches from today's settings);
 * the raw stored value may lag behind them.
 */
export function withoutToolsStore<T extends Record<string, unknown>>(row: T): Omit<T, "toolsConfig" | "transferNumberParked"> {
  const { toolsConfig: _t, transferNumberParked: _p, ...rest } = row;
  void [_t, _p];
  return rest;
}
