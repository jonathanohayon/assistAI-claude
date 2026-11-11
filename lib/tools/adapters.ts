// Today's settings → the Tools contract (T1). Pure.
//   receptionist: the CRM tile toggles (lib/tile-toggles.ts) for booking,
//     contacts and orders; transfer has no switch today (on whenever a
//     number is set) → enabled.
//   outbound: no switches and no tools today (until T4).
import type { PlanFeatures } from "@/lib/plan-features";
import type { TileToggles } from "@/lib/tile-toggles";
import { CLIENT_AGENT_OFF, TOOLS_VERSION, type EffectiveCapabilities, type Tools } from "@/lib/tools/contract";

export function toolsFromTileToggles(t: TileToggles): Tools {
  return {
    version: TOOLS_VERSION,
    booking: { enabled: t.calendar, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: t.customers },
    transfer: { enabled: true, when: "always" },
    orders: { enabled: t.orders, ask: "" },
    clientAgent: CLIENT_AGENT_OFF,
  };
}

export const OUTBOUND_TOOLS: Tools = {
  version: TOOLS_VERSION,
  booking: { enabled: false, defaultDurationMinutes: null, minNoticeMinutes: null },
  contacts: { enabled: false },
  transfer: { enabled: false, when: "always" },
  orders: { enabled: false, ask: "" },
  clientAgent: CLIENT_AGENT_OFF,
};

// ── Capabilities → today's payload fields (the call side) ──────────────

/** Receptionist: `features` (plan map with calendar/crm overridden) + `ordersEnabled`. */
export function receptionistCallFields(caps: EffectiveCapabilities, plan: PlanFeatures) {
  return {
    features: { ...plan, calendar: caps.booking.active, crm: caps.contacts.active },
    ordersEnabled: caps.orders.active,
  };
}

/**
 * Outbound (T4): what the worker needs to run the tools — ONLY when at least
 * one is active ({} otherwise: OUTBOUND_TOOLS off = today's payload, byte for
 * byte). The tools route by `accountId` (x-tenant-user-id), never by the
 * call's numbers: a campaign without its own caller id shows the trunk's
 * default number, which may not be this account's.
 */
export function outboundToolFields(caps: EffectiveCapabilities, accountId: string, transferNumber: string) {
  if (!caps.booking.active && !caps.transfer.active) return {};
  return { accountId, ...(caps.transfer.active ? { transferNumber } : {}) };
}

/** Outbound: calendar = booking (T4, off by default); no CRM / WhatsApp. */
export function outboundCallFeatures(caps: EffectiveCapabilities) {
  return {
    calendar: caps.booking.active,
    crm: caps.contacts.active,
    whatsapp_confirm: false,
    whatsapp_recap: false,
    outbound_campaigns: true,
  };
}

/**
 * Receptionist (T5): the `clientAgent` key for the worker (T5c reads it) —
 * ONLY when the capability is active ({} otherwise: CLIENT_AGENT off =
 * today's payload, byte for byte). The secret only when one is set.
 */
export function clientAgentCallField(caps: EffectiveCapabilities, tools: Tools) {
  if (!caps.clientAgent.active) return {};
  const { url, secret, mode } = tools.clientAgent;
  return { clientAgent: { url, ...(secret ? { secret } : {}), mode } };
}
